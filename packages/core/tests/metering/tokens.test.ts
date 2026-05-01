import { describe, expect, it } from 'vitest'
import { estimateSavings } from '../../src/metering/tokens.js'
import { getStats } from '../../src/metering/stats.js'
import type { MemoryBackend, MindrMemory, MindrSession, SearchParams, StoreParams } from '../../src/storage/backend.js'
import type { MindrTag } from '../../src/schema.js'

class MockBackend implements MemoryBackend {
  constructor(private readonly memories: MindrMemory[]) {}
  async createSession(): Promise<MindrSession> { return { sessionId: 's', createdAt: new Date().toISOString() } }
  async store(_: StoreParams): Promise<MindrMemory> { throw new Error('unused') }
  async search(_: SearchParams): Promise<MindrMemory[]> { return [] }
  async forget(_: string): Promise<void> {}
  async getById(_: string): Promise<MindrMemory | null> { return null }
  async searchByCommitSet(): Promise<MindrMemory[]> { return [] }
  async listByTags(tags: MindrTag[]): Promise<MindrMemory[]> {
    return this.memories.filter((m) =>
      tags.every((tag) => m.tags.some((mt) => mt.key === tag.key && mt.value === tag.value)),
    )
  }
}

function mem(id: string, createdAt: string, metadata: Record<string, unknown>, sessionId = 's1'): MindrMemory {
  return {
    id,
    role: 'system',
    content: `metering ${id}`,
    tags: [{ key: 'type', value: 'metering' }, { key: 'session', value: sessionId }],
    metadata,
    sessionId,
    createdAt,
  }
}

describe('token waste estimates', () => {
  it('uses a conservative range that never overstates direct savings', () => {
    const result = estimateSavings(5, ['This is a much larger context that would otherwise be read in full.'])
    expect(result.high).toBeLessThanOrEqual(result.saved)
    expect(result.low).toBeLessThanOrEqual(result.high)
  })

  it('filters stats by --last-style time windows', async () => {
    const recent = new Date().toISOString()
    const old = new Date(Date.now() - 10 * 86_400_000).toISOString()
    const stats = await getStats(new MockBackend([
      mem('recent', recent, { tokensInjected: 10, estimatedSaved: 30 }),
      mem('old', old, { tokensInjected: 100, estimatedSaved: 300 }),
    ]), { last: '1d' })

    expect(stats.tokensInjected).toBe(10)
    expect(stats.estimatedSaved).toBe(30)
    expect(stats.range.high).toBe(30)
  })
})
