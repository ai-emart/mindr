// Pure naming-classification utilities — no I/O, no tree-sitter.

export function classifyIdentifier(name: string): string {
  // Strip leading underscores (private convention) before classifying.
  const s = name.replace(/^_+/, '')
  if (s.length < 2) return 'other'

  // SCREAMING_SNAKE: ALL_CAPS with at least one underscore
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(s)) return 'SCREAMING_SNAKE'

  // PascalCase: starts uppercase, no underscores
  if (/^[A-Z][a-zA-Z0-9]*$/.test(s)) return 'PascalCase'

  // camelCase: starts lowercase, has at least one uppercase letter, no underscores
  if (/^[a-z]/.test(s) && /[A-Z]/.test(s) && !s.includes('_')) return 'camelCase'

  // snake_case: lowercase letters/digits with underscores
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(s)) return 'snake_case'

  // lowercase: all lowercase, no underscores (single word or multi-char abbreviation)
  if (/^[a-z][a-z0-9]*$/.test(s)) return 'lowercase'

  return 'other'
}

export function classifyFileName(basename: string): string {
  // Remove extension(s) — handle double extensions like .test.ts
  const name = basename.replace(/(\.\w+)+$/, '')
  if (!name || name.length < 2) return 'other'

  if (/^[A-Z][a-zA-Z0-9]*$/.test(name)) return 'PascalCase'
  if (/^[a-z]/.test(name) && /[A-Z]/.test(name) && !name.includes('-') && !name.includes('_'))
    return 'camelCase'
  if (name.includes('-') && /^[a-z][a-z0-9-]*$/.test(name)) return 'kebab-case'
  if (name.includes('_') && /^[a-z][a-z0-9_]*$/.test(name)) return 'snake_case'
  if (/^[a-z][a-z0-9]*$/.test(name)) return 'lowercase'

  return 'other'
}

export function classifyTestPattern(relPath: string): string {
  const p = relPath.replace(/\\/g, '/')
  if (p.includes('/__tests__/')) return '__tests__'
  if (p.includes('/tests/') || p.startsWith('tests/')) return 'tests/'
  if (/\.(test|spec)\.[jt]sx?$/.test(p)) return p.includes('.spec.') ? '*.spec.*' : '*.test.*'
  return 'other'
}

export function isTestFile(relPath: string): boolean {
  const p = relPath.replace(/\\/g, '/')
  return (
    p.includes('/__tests__/') ||
    p.includes('/tests/') ||
    p.startsWith('tests/') ||
    /\.(test|spec)\.[jt]sx?$/.test(p)
  )
}

export function consistencyScore(observed: Record<string, number>): number {
  const total = Object.values(observed).reduce((s, n) => s + n, 0)
  if (total === 0) return 0
  const max = Math.max(...Object.values(observed))
  return Math.round((max / total) * 100)
}

export function dominantStyle(observed: Record<string, number>): string | null {
  const entries = Object.entries(observed).filter(([, n]) => n > 0)
  if (entries.length === 0) return null
  return entries.sort(([, a], [, b]) => b - a)[0][0]
}
