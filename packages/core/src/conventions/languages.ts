// Tree-sitter language loader with graceful per-language fallback.
// If a prebuilt binary is unavailable the language is skipped with a warning.

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface LanguageSpec {
  name: string
  extensions: readonly string[]
  /** Resolves to the tree-sitter Language object, or null if unavailable. */
  load: () => Promise<any>
}

// Lazy-loaded core Parser — null until first successful load.
let ParserClass: (new () => any) | null = null
let parserLoadAttempted = false

export async function getParser(): Promise<(new () => any) | null> {
  if (parserLoadAttempted) return ParserClass
  parserLoadAttempted = true
  try {
    const mod = await import('tree-sitter')
    ParserClass = (mod.default ?? mod) as new () => any
    return ParserClass
  } catch (e) {
    process.stderr.write(
      `mindr: tree-sitter native binary not available — convention analysis disabled (${String(e)})\n`,
    )
    return null
  }
}

async function tryLoad(pkg: string, key?: string): Promise<any> {
  try {
    const mod = await import(pkg)
    const raw = (mod.default ?? mod) as any
    const lang = key ? (raw?.[key] ?? null) : raw
    if (!lang) throw new Error(`no export '${key ?? 'default'}' in ${pkg}`)
    return lang
  } catch (e) {
    process.stderr.write(`mindr: ${pkg} unavailable, skipping (${String(e)})\n`)
    return null
  }
}

export const LANGUAGE_SPECS: LanguageSpec[] = [
  {
    name: 'typescript',
    extensions: ['.ts', '.tsx'],
    load: () => tryLoad('tree-sitter-typescript', 'typescript'),
  },
  {
    name: 'javascript',
    extensions: ['.js', '.jsx', '.mjs', '.cjs'],
    load: () => tryLoad('tree-sitter-javascript'),
  },
  {
    name: 'python',
    extensions: ['.py'],
    load: () => tryLoad('tree-sitter-python'),
  },
  {
    name: 'go',
    extensions: ['.go'],
    load: () => tryLoad('tree-sitter-go'),
  },
  {
    name: 'rust',
    extensions: ['.rs'],
    load: () => tryLoad('tree-sitter-rust'),
  },
]

// Map extension → spec (built once, used for each file).
export function buildExtMap(
  specs: LanguageSpec[],
  loaded: Map<string, any>,
): Map<string, { name: string; language: any }> {
  const m = new Map<string, { name: string; language: any }>()
  for (const spec of specs) {
    const lang = loaded.get(spec.name)
    if (!lang) continue
    for (const ext of spec.extensions) {
      m.set(ext, { name: spec.name, language: lang })
    }
  }
  return m
}
