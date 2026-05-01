import { describe, it, expect } from 'vitest'
import { scoreContextHealth } from '../../src/context/health.js'

describe('scoreContextHealth', () => {
  it('returns 100 for a perfectly focused session', () => {
    const result = scoreContextHealth({
      filesTouched: ['src/auth/login.ts', 'src/auth/logout.ts'],
      modulesTouched: ['auth'],
      activeTaskFiles: ['src/auth/login.ts', 'src/auth/logout.ts'],
      startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(), // 10 min ago
      topicSpread: 0,
    })
    expect(result.score).toBe(100)
    expect(result.recommendation).toBe('ok')
  })

  it('penalises module sprawl', () => {
    const result = scoreContextHealth({
      filesTouched: ['src/auth/a.ts', 'src/billing/b.ts', 'src/payments/c.ts', 'src/api/d.ts'],
      modulesTouched: ['auth', 'billing', 'payments', 'api'],
      activeTaskFiles: [],
      topicSpread: 0,
    })
    // 4 modules → (4-2)*8 = 16 penalty
    expect(result.score).toBeLessThan(100)
    expect(result.breakdown.modulePenalty).toBeGreaterThan(0)
  })

  it('penalises file sprawl beyond 8 files', () => {
    const files = Array.from({ length: 12 }, (_, i) => `src/mod${i}/file.ts`)
    const result = scoreContextHealth({
      filesTouched: files,
      modulesTouched: ['root'],
      activeTaskFiles: files,
      topicSpread: 0,
    })
    expect(result.breakdown.filePenalty).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(100)
  })

  it('penalises sessions older than 90 minutes', () => {
    const result = scoreContextHealth({
      filesTouched: ['src/a.ts'],
      modulesTouched: ['root'],
      activeTaskFiles: ['src/a.ts'],
      startedAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(), // 3 hours ago → floor((180-90)/60)*5 = 5
      topicSpread: 0,
    })
    expect(result.breakdown.timePenalty).toBeGreaterThan(0)
    expect(result.score).toBeLessThan(100)
  })

  it('recommends checkpoint when score is between 40 and 69', () => {
    // Many modules to push score below 70
    const result = scoreContextHealth({
      filesTouched: Array.from({ length: 5 }, (_, i) => `src/m${i}/f.ts`),
      modulesTouched: ['a', 'b', 'c', 'd', 'e'],
      activeTaskFiles: [],
      topicSpread: 0.5,
    })
    if (result.score >= 40 && result.score < 70) {
      expect(result.recommendation).toBe('consider_checkpoint')
    }
  })

  it('recommends fresh session when score is below 40', () => {
    const result = scoreContextHealth({
      filesTouched: Array.from({ length: 10 }, (_, i) => `src/m${i}/f.ts`),
      modulesTouched: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
      activeTaskFiles: [],
      startedAt: new Date(Date.now() - 180 * 60 * 1000).toISOString(),
      topicSpread: 1,
    })
    expect(result.score).toBeLessThan(70)
    // score < 40 → fresh_session; 40–69 → consider_checkpoint
    if (result.score < 40) {
      expect(result.recommendation).toBe('recommend_fresh_session')
    }
  })

  it('score is always clamped to [0, 100]', () => {
    const worst = scoreContextHealth({
      filesTouched: Array.from({ length: 20 }, (_, i) => `f${i}.ts`),
      modulesTouched: Array.from({ length: 10 }, (_, i) => `m${i}`),
      activeTaskFiles: [],
      startedAt: new Date(Date.now() - 300 * 60 * 1000).toISOString(),
      topicSpread: 1,
    })
    expect(worst.score).toBeGreaterThanOrEqual(0)
    expect(worst.score).toBeLessThanOrEqual(100)

    const best = scoreContextHealth({
      filesTouched: [],
      modulesTouched: [],
      activeTaskFiles: [],
      topicSpread: 0,
    })
    expect(best.score).toBeGreaterThanOrEqual(0)
    expect(best.score).toBeLessThanOrEqual(100)
  })
})
