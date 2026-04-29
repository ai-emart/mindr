// Convention detector: walks a git repo and analyses identifier/file naming styles.

import { readFileSync } from 'fs'
import { basename, extname, relative } from 'path'
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
    fileCount: number
    fileCounts: Map<string, number>  // per-language file count for cap
  }>()

  function ensureLang(name: string) {
    if (!perLang.has(name)) {
      perLang.set(name, {
        tallies: new Map(),
        fileStyles: {},
        testPatterns: {},
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

    // AST identifier analysis
    try {
      const parser = new ParserClass()
      parser.setLanguage(language)
      const tree = parser.parse(src)
      walkNode(tree.rootNode, langName, state.tallies)
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

    profiles.push({
      language: langName,
      conventions,
      analyzedFiles: state.fileCount,
      analyzedAt: new Date().toISOString(),
    })
  }

  return profiles
}
