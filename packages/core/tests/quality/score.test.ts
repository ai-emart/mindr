import { describe, expect, it } from 'vitest'
import { scoreMemoryQuality } from '../../src/quality/score.js'
import type { MindrMemory } from '../../src/storage/backend.js'

function memory(overrides: Partial<MindrMemory> = {}): MindrMemory {
  return {
    id: 'm1',
    role: 'system',
    content: 'memory',
    tags: [],
    metadata: null,
    sessionId: null,
    createdAt: '2026-04-30T00:00:00.000Z',
    ...overrides,
  }
}

describe('scoreMemoryQuality', () => {
  const now = new Date('2026-05-01T00:00:00.000Z')

  it('scores all five dimensions with verified sums', () => {
    const scored = scoreMemoryQuality(memory({
      tags: [
        { key: 'git_commit', value: 'abc123' },
        { key: 'source', value: 'manual' },
        { key: 'contradicted', value: 'true' },
      ],
    }), { retrievalCount: 7, now })

    expect(scored.recency).toBe(30)
    expect(scored.commitAssociation).toBe(25)
    expect(scored.manualCapture).toBe(20)
    expect(scored.retrievalFrequency).toBe(15)
    expect(scored.contradictionPenalty).toBe(-10)
    expect(scored.total).toBe(80)
  })

  it('clamps scores to 0-100', () => {
    const low = scoreMemoryQuality(memory({
      createdAt: '2020-01-01T00:00:00.000Z',
      tags: [{ key: 'contradicted', value: 'true' }],
    }), { now })
    expect(low.total).toBeGreaterThanOrEqual(0)

    const high = scoreMemoryQuality(memory({
      tags: [
        { key: 'git_commit', value: 'abc123' },
        { key: 'source', value: 'manual' },
      ],
    }), { retrievalCount: 1000, now })
    expect(high.total).toBeLessThanOrEqual(100)
  })
})
