import type { MemoryBackend } from '../storage/backend.js'

export interface MindrStats {
  sessions: number
  tokensInjected: number
  tokensSelfReported: number
  estimatedSaved: number
  range: { low: number; high: number }
}

export async function getStats(backend: MemoryBackend, sessionId?: string): Promise<MindrStats> {
  const mems = await backend.listByTags([{ key: 'type', value: 'metering' }], 1000)
  const filtered = sessionId ? mems.filter((m) => m.sessionId === sessionId || m.tags.some((t) => t.key === 'session' && t.value === sessionId)) : mems
  const sessions = new Set<string>()
  let tokensInjected = 0
  let tokensSelfReported = 0
  let estimatedSaved = 0
  for (const mem of filtered) {
    if (mem.sessionId) sessions.add(mem.sessionId)
    const meta = mem.metadata ?? {}
    tokensInjected += typeof meta['tokensInjected'] === 'number' ? meta['tokensInjected'] : 0
    tokensSelfReported += typeof meta['tokensSelfReported'] === 'number' ? meta['tokensSelfReported'] : 0
    estimatedSaved += typeof meta['estimatedSaved'] === 'number' ? meta['estimatedSaved'] : 0
  }
  return {
    sessions: sessionId ? 1 : sessions.size,
    tokensInjected,
    tokensSelfReported,
    estimatedSaved,
    range: {
      low: Math.round(estimatedSaved * 0.7),
      high: Math.round(estimatedSaved * 1.3),
    },
  }
}
