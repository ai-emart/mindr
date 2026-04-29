import type { MemoryBackend, MindrMemory } from '../storage/backend.js'
import { functionFingerprints } from './fingerprint.js'

export interface BugPatternMatch {
  memory: MindrMemory
  fingerprint: string
}

export interface BugPatternCheck {
  totalFingerprints: number
  hits: number
  confidence: number
  matches: BugPatternMatch[]
}

export async function checkForBugPatterns(
  backend: MemoryBackend,
  code: string,
  language: string,
): Promise<BugPatternCheck> {
  const fps = functionFingerprints(code, language)
  const matches: BugPatternMatch[] = []
  const seenMemoryIds = new Set<string>()

  for (const fp of fps) {
    const candidates = await backend.listByTags([
      { key: 'type', value: 'bug_pattern' },
      { key: 'language', value: language },
      { key: 'fingerprint', value: fp.hash },
    ])
    for (const memory of candidates) {
      const hasType = memory.tags.some((tag) => tag.key === 'type' && tag.value === 'bug_pattern')
      const hasLanguage = memory.tags.some((tag) => tag.key === 'language' && tag.value === language)
      const hasFingerprint = memory.tags.some((tag) => tag.key === 'fingerprint' && tag.value === fp.hash)
      if (!hasType || !hasLanguage || !hasFingerprint || seenMemoryIds.has(memory.id)) continue
      seenMemoryIds.add(memory.id)
      matches.push({ memory, fingerprint: fp.hash })
    }
  }

  const totalFingerprints = Math.max(1, fps.length)
  const hits = matches.length
  return {
    totalFingerprints: fps.length,
    hits,
    confidence: hits / totalFingerprints,
    matches,
  }
}
