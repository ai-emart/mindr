// Convention detector: walks a git repo and analyses identifier/file naming styles.

/* eslint-disable @typescript-eslint/no-explicit-any */

import { readFileSync } from 'fs'
import { basename, extname } from 'path'
import { simpleGit } from 'simple-git'
import {
  getParser,
  buildExtMap,
  LANGUAGE_SPECS,
} from './languages.js'
import {
  classifyIdentifier,
  classifyFileName,
  classifyTestPattern,
  isTestFile,
  consistencyScore,
  dominantStyle,
} from './patterns.js'

export interface Convention {
  pattern: string
  category: string
  score: number
  sampleCount: number
}

export interface ConventionProfile {
  language: string
  conventions: Convention[]
  analyzedFiles: number
  analyzedAt: string
}

export interface DetectOptions {
  maxFiles?: number
  maxFileBytes?: number
  /** Override file list instead of running git ls-files (relative paths from repoRoot). */
  files?: string[]
}

// Per-language node-type extractors: { nodeType, category, nameChildTypes[] }
const EXTRACTORS: Record<string, Array<{ nodeType: string; category: string; nameChildTypes: string[] }>> = {
  typescript: [
    { nodeType: 'function_declaration', category: 'functionNames', nameChildTypes: ['identifier'] },
    { nodeType: 'method_definition', category: 'functionNames', nameChildTypes: ['property_identifier'] },
    { nodeType: 'variable_declarator', category: 'variableNames', nameChildTypes: ['identifier'] },
    { nodeType: 'class_declaration', category: 'classNames', nameChildTypes: ['type_identifier'] },
  ],
  javascript: [
    { nodeType: 'function_declaration', category: 'functionNames', nameChildTypes: ['identifier'] },
    { nodeType: 'method_definition', category: 'functionNames', nameChildTypes: ['property_identifier'] },
    { nodeType: 'variable_declarator', category: 'variableNames', nameChildTypes: ['identifier'] },
    { nodeType: 'class_declaration', category: 'classNames', nameChildTypes: ['identifier'] },
  ],
  python: [
    { nodeType: 'function_definition', category: 'functionNames', nameChildTypes: ['identifier'] },
    { nodeType: 'class_definition', category: 'classNames', nameChildTypes: ['identifier'] },
  ],
  go: [
    { nodeType: 'function_declaration', category: 'functionNames', nameChildTypes: ['identifier'] },
    { nodeType: 'method_declaration', category: 'functionNames', nameChildTypes: ['field_identifier'] },
    { nodeType: 'type_spec', category: 'classNames', nameChildTypes: ['type_identifier'] },
  ],
  rust: [
    { nodeType: 'function_item', category: 'functionNames', nameChildTypes: ['identifier'] },
    { nodeType: 'struct_item', category: 'classNames', nameChildTypes: ['type_identifier'] },
    { nodeType: 'let_declaration', category: 'variableNames', nameChildTypes: ['identifier'] },
  ],
}

// ---------------------------------------------------------------------------
// Import ordering detection (TypeScript / JavaScript, text-based)
// ---------------------------------------------------------------------------

const JS_BUILTINS = new Set([
  'fs', 'path', 'crypto', 'http', 'https', 'os', 'stream', 'util', 'events',
  'url', 'net', 'child_process', 'assert', 'buffer', 'readline',
  'worker_threads', 'vm', 'cluster', 'dns', 'tty', 'zlib', 'timers',
])

type ImportKind = 'builtin' | 'third-party' | 'local'

function classifyImportSource(src: string): ImportKind {
  if (src.startsWith('node:') || JS_BUILTINS.has(src.split('/')[0] ?? '')) return 'builtin'
  if (src.startsWith('.') || src.startsWith('/')) return 'local'
  return 'third-party'
}

function detectImportGrouping(src: string): string | null {
  const kinds: ImportKind[] = []
  for (const line of src.split('\n')) {
    const t = line.trim()
    if (!t.startsWith('import ') && !t.startsWith('import{')) continue
    const m = t.match(/from\s+['"]([^'"]+)['"]/)
    if (!m) continue
    kinds.push(classifyImportSource(m[1]!))
  }
  if (kinds.length < 3) return null
  // Grouped = each kind appears in one contiguous block (no kind reappears after switching away)
  const seen = new Set<ImportKind>()
  let last = kinds[0]!
  seen.add(last)
  for (const k of kinds.slice(1)) {
    if (k !== last) {
      if (seen.has(k)) return 'mixed'
      seen.add(k)
      last = k
    }
  }
  return 'grouped'
}

// ---------------------------------------------------------------------------
// Error-handling pattern detection (AST-based, integrated into walkNode)
// ---------------------------------------------------------------------------

function walkNodeForErrorHandling(
  node: any,
  langName: string,
  tally: Record<string, number>,
): void {
  if ((langName === 'typescript' || langName === 'javascript') && node.type === 'catch_clause') {
    // TS typed catch: catch (e: SomeType) or catch (e: unknown)
    const hasTypeAnnotation = (node.children as any[]).some(
      (c: any) =>
        (c.type === 'catch_formal_parameter' || c.type === 'formal_parameter') &&
        (c.children as any[]).some((cc: any) => cc.type === 'type_annotation'),
    )
    const key = hasTypeAnnotation ? 'typed-catch' : 'untyped-catch'
    tally[key] = (tally[key] ?? 0) + 1
  }
  if (langName === 'python' && node.type === 'except_clause') {
    // except vs except SomeError
    const hasType = (node.children as any[]).some(
      (c: any) => c.type !== 'except' && c.type !== ':' && c.type !== 'comment',
    )
    const key = hasType ? 'specific-except' : 'bare-except'
    tally[key] = (tally[key] ?? 0) + 1
  }
  for (const child of node.children as any[]) {
    walkNodeForErrorHandling(child, langName, tally)
  }
}

// ---------------------------------------------------------------------------

function firstChildOfTypes(node: any, types: string[]): string | null {
  for (const child of (node.children as any[])) {
    if (types.includes(child.type)) return child.text as string
  }
  return null
}

function walkNode(
  node: any,
  langName: string,
  tallies: Map<string, Record<string, number>>,
): void {
  const extractors = EXTRACTORS[langName] ?? []
  for (const ex of extractors) {
    if (node.type === ex.nodeType) {
      const name = firstChildOfTypes(node, ex.nameChildTypes)
      if (name && name.length >= 2) {
        const style = classifyIdentifier(name)
        if (!tallies.has(ex.category)) tallies.set(ex.category, {})
        const bucket = tallies.get(ex.category)!
        bucket[style] = (bucket[style] ?? 0) + 1
      }
    }
  }
  for (const child of (node.children as any[])) {
    walkNode(child, langName, tallies)
  }
}

async function getTrackedFiles(repoRoot: string): Promise<string[]> {
  const git = simpleGit({ baseDir: repoRoot })
  try {
    const out = await git.raw(['ls-files', '--cached', '--others', '--exclude-standard'])
    return out.split('\n').map((l) => l.trim()).filter(Boolean)
  } catch {
    return []
  }
}

export async function detect(
  repoRoot: string,
  options: DetectOptions = {},
): Promise<ConventionProfile[]> {
  const maxFiles = options.maxFiles ?? 500
  const maxFileBytes = options.maxFileBytes ?? 100_000

  const ParserClass = await getParser()
  if (!ParserClass) return []

  // Load all available language grammars
  const loaded = new Map<string, any>()
  for (const spec of LANGUAGE_SPECS) {
    const lang = await spec.load()
    if (lang) loaded.set(spec.name, lang)
  }
  if (loaded.size === 0) return []

  const extMap = buildExtMap(LANGUAGE_SPECS, loaded)

  // Tally structures per language
  const perLang = new Map<string, {
    tallies: Map<string, Record<string, number>>
    fileStyles: Record<string, number>
    testPatterns: Record<string, number>
    importOrdering: Record<string, number>
    errorHandling: Record<string, number>
    fileCount: number
    fileCounts: Map<string, number>  // per-language file count for cap
  }>()

  function ensureLang(name: string) {
    if (!perLang.has(name)) {
      perLang.set(name, {
        tallies: new Map(),
        fileStyles: {},
        testPatterns: {},
        importOrdering: {},
        errorHandling: {},
        fileCount: 0,
        fileCounts: new Map(),
      })
    }
    return perLang.get(name)!
  }

  const trackedFiles = options.files ?? await getTrackedFiles(repoRoot)

  // Per-language file counts for cap enforcement
  const langFileCounts = new Map<string, number>()

  for (const relPath of trackedFiles) {
    const ext = extname(relPath)
    const entry = extMap.get(ext)
    if (!entry) continue

    const { name: langName, language } = entry
    const count = langFileCounts.get(langName) ?? 0
    if (count >= maxFiles) continue
    langFileCounts.set(langName, count + 1)

    const absPath = `${repoRoot}/${relPath}`
    let src: string
    try {
      const buf = readFileSync(absPath)
      if (buf.length > maxFileBytes) continue
      src = buf.toString('utf8')
    } catch {
      continue
    }

    const state = ensureLang(langName)
    state.fileCount++

    // File name convention
    const base = basename(relPath)
    const fileStyle = classifyFileName(base)
    state.fileStyles[fileStyle] = (state.fileStyles[fileStyle] ?? 0) + 1

    // Test file pattern
    if (isTestFile(relPath)) {
      const pattern = classifyTestPattern(relPath)
      state.testPatterns[pattern] = (state.testPatterns[pattern] ?? 0) + 1
    }

    // Import ordering (text-based, only JS/TS)
    if (langName === 'typescript' || langName === 'javascript') {
      const ordering = detectImportGrouping(src)
      if (ordering) {
        state.importOrdering[ordering] = (state.importOrdering[ordering] ?? 0) + 1
      }
    }

    // AST identifier + error handling analysis
    try {
      const parser = new ParserClass()
      parser.setLanguage(language)
      const tree = parser.parse(src)
      walkNode(tree.rootNode, langName, state.tallies)
      walkNodeForErrorHandling(tree.rootNode, langName, state.errorHandling)
    } catch {
      // Silently skip unparseable files
    }
  }

  const profiles: ConventionProfile[] = []

  for (const [langName, state] of perLang) {
    if (state.fileCount === 0) continue

    const conventions: Convention[] = []

    // Identifier-based conventions
    for (const [category, observed] of state.tallies) {
      const style = dominantStyle(observed)
      if (!style) continue
      const total = Object.values(observed).reduce((s, n) => s + n, 0)
      if (total < 3) continue  // too few samples to be meaningful
      conventions.push({
        pattern: style,
        category,
        score: consistencyScore(observed),
        sampleCount: total,
      })
    }

    // File naming convention
    {
      const style = dominantStyle(state.fileStyles)
      const total = Object.values(state.fileStyles).reduce((s, n) => s + n, 0)
      if (style && total >= 3) {
        conventions.push({
          pattern: style,
          category: 'fileNames',
          score: consistencyScore(state.fileStyles),
          sampleCount: total,
        })
      }
    }

    // Test file pattern
    {
      const style = dominantStyle(state.testPatterns)
      const total = Object.values(state.testPatterns).reduce((s, n) => s + n, 0)
      if (style && total >= 2) {
        conventions.push({
          pattern: style,
          category: 'testFilePattern',
          score: consistencyScore(state.testPatterns),
          sampleCount: total,
        })
      }
    }

    // Import ordering (JS/TS only)
    {
      const style = dominantStyle(state.importOrdering)
      const total = Object.values(state.importOrdering).reduce((s, n) => s + n, 0)
      if (style && total >= 3) {
        conventions.push({
          pattern: style,
          category: 'importOrdering',
          score: consistencyScore(state.importOrdering),
          sampleCount: total,
        })
      }
    }

    // Error handling patterns
    {
      const style = dominantStyle(state.errorHandling)
      const total = Object.values(state.errorHandling).reduce((s, n) => s + n, 0)
      if (style && total >= 3) {
        conventions.push({
          pattern: style,
          category: 'errorHandling',
          score: consistencyScore(state.errorHandling),
          sampleCount: total,
        })
      }
    }

    profiles.push({
      language: langName,
      conventions,
      analyzedFiles: state.fileCount,
      analyzedAt: new Date().toISOString(),
    })
  }

  return profiles
}
