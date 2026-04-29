export interface MindrTag {
  key: string
  value: string
}

export const MEMORY_TYPES = [
  'decision',
  'convention',
  'bug_pattern',
  'debt',
  'debt_resolved',
  'session_checkpoint',
  'note',
  'context',
] as const

export type MemoryType = (typeof MEMORY_TYPES)[number]

const PREFIX = 'mindr'

export function tagsToStrings(tags: MindrTag[]): string[] {
  return tags.map((t) => `${PREFIX}:${t.key}:${t.value}`)
}

export function tagsFromStrings(raw: string[]): MindrTag[] {
  const result: MindrTag[] = []
  for (const s of raw) {
    if (!s.startsWith(`${PREFIX}:`)) continue
    const rest = s.slice(PREFIX.length + 1)
    const colon = rest.indexOf(':')
    if (colon === -1) continue
    result.push({ key: rest.slice(0, colon), value: rest.slice(colon + 1) })
  }
  return result
}

export function decisionTags(opts: {
  module: string
  commit?: string
  confidence?: string
}): MindrTag[] {
  const tags: MindrTag[] = [
    { key: 'type', value: 'decision' },
    { key: 'module', value: opts.module },
  ]
  if (opts.commit) tags.push({ key: 'commit', value: opts.commit })
  if (opts.confidence) tags.push({ key: 'confidence', value: opts.confidence })
  return tags
}

export function bugTags(opts: {
  module: string
  language?: string
  fingerprint?: string
  fixCommit?: string
}): MindrTag[] {
  const tags: MindrTag[] = [
    { key: 'type', value: 'bug_pattern' },
    { key: 'module', value: opts.module },
  ]
  if (opts.language) tags.push({ key: 'language', value: opts.language })
  if (opts.fingerprint) tags.push({ key: 'fingerprint', value: opts.fingerprint })
  if (opts.fixCommit) tags.push({ key: 'fix_commit', value: opts.fixCommit })
  return tags
}

export function conventionTags(opts: {
  module: string
  language?: string
  pattern?: string
  score?: number
}): MindrTag[] {
  const tags: MindrTag[] = [
    { key: 'type', value: 'convention' },
    { key: 'module', value: opts.module },
  ]
  if (opts.language) tags.push({ key: 'language', value: opts.language })
  if (opts.pattern) tags.push({ key: 'pattern', value: opts.pattern })
  if (opts.score != null) tags.push({ key: 'score', value: String(opts.score) })
  return tags
}

export function debtTags(opts: { module: string; severity?: string; debtId?: string }): MindrTag[] {
  const tags: MindrTag[] = [
    { key: 'type', value: 'debt' },
    { key: 'module', value: opts.module },
  ]
  if (opts.severity) tags.push({ key: 'severity', value: opts.severity })
  if (opts.debtId) tags.push({ key: 'debt_id', value: opts.debtId })
  return tags
}

export function sessionCheckpointTags(opts: { sessionId: string; module?: string }): MindrTag[] {
  const tags: MindrTag[] = [
    { key: 'type', value: 'session_checkpoint' },
    { key: 'session', value: opts.sessionId },
  ]
  if (opts.module) tags.push({ key: 'module', value: opts.module })
  return tags
}

export function noteTags(opts: { module: string }): MindrTag[] {
  return [
    { key: 'type', value: 'note' },
    { key: 'module', value: opts.module },
  ]
}

export function contextTags(opts: { module: string; branch?: string }): MindrTag[] {
  const tags: MindrTag[] = [
    { key: 'type', value: 'context' },
    { key: 'module', value: opts.module },
  ]
  if (opts.branch) tags.push({ key: 'branch', value: opts.branch })
  return tags
}
