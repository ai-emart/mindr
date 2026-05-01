import type { MemoryBackend } from '../storage/backend.js'

export interface MindrStats {
  sessions: number
  tokensInjected: number
  tokensSelfReported: number
  estimatedSaved: number
  range: { low: number; high: number }
}

export interface StatsOptions {
  sessionId?: string
  last?: string
}

function cutoffFromLast(last?: string): Date | null {
  if (!last) return null
  const match = /^(\d+)(m|h|d|w)$/i.exec(last.trim())
  if (!match) return null
  const amount = Number.parseInt(match[1]!, 10)
  const unit = match[2]!.toLowerCase()
  const millis =
    unit === 'm' ? amount * 60_000 :
    unit === 'h' ? amount * 3_600_000 :
    unit === 'd' ? amount * 86_400_000 :
    amount * 7 * 86_400_000
  return new Date(Date.now() - millis)
}

export async function getStats(backend: MemoryBackend, opts: string | StatsOptions = {}): Promise<MindrStats> {
  const options: StatsOptions = typeof opts === 'string' ? { sessionId: opts } : opts
  const mems = await backend.listByTags([{ key: 'type', value: 'metering' }], 1000)
  const cutoff = cutoffFromLast(options.last)
  const filtered = mems.filter((m) => {
    const matchesSession = options.sessionId
      ? m.sessionId === options.sessionId || m.tags.some((t) => t.key === 'session' && t.value === options.sessionId)
      : true
    const matchesWindow = cutoff ? new Date(m.createdAt) >= cutoff : true
    return matchesSession && matchesWindow
  })
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
    sessions: options.sessionId ? 1 : sessions.size,
    tokensInjected,
    tokensSelfReported,
    estimatedSaved,
    range: {
      low: Math.round(estimatedSaved * 0.5),
      high: estimatedSaved,
    },
  }
}
