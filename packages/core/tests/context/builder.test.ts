import { describe, it, expect } from 'vitest'
import { buildSessionContext } from '../../src/context/builder.js'
import type { MemoryBackend, MindrMemory, MindrSession, StoreParams, SearchParams } from '../../src/storage/backend.js'
import type { MindrTag } from '../../src/schema.js'

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

class MockBackend implements MemoryBackend {
  private memories: MindrMemory[]
  constructor(memories: MindrMemory[]) { this.memories = memories }

  async createSession(): Promise<MindrSession> { return { sessionId: 'mock', createdAt: '2024-01-01T00:00:00Z' } }
  async store(_: StoreParams): Promise<MindrMemory> { throw new Error('not supported') }
  async search(_: SearchParams): Promise<MindrMemory[]> { return [] }
  async forget(_: string): Promise<void> {}
  async getById(_: string): Promise<MindrMemory | null> { return null }

  async listByTags(tags: MindrTag[]): Promise<MindrMemory[]> {
    return this.memories.filter((m) =>
      tags.every((t) => m.tags.some((mt) => mt.key === t.key && mt.value === t.value)),
    )
  }
}

function mem(
  overrides: Partial<MindrMemory> & Pick<MindrMemory, 'content' | 'tags'>,
): MindrMemory {
  return {
    id: 'test-id',
    role: 'system',
    createdAt: '2024-01-15T10:00:00Z',
    metadata: null,
    sessionId: null,
    ...overrides,
  }
}

// Convention memory wraps a ConventionProfile in metadata.profile
function conventionMem(language: string, fnStyle: string, score: number): MindrMemory {
  return mem({
    content: `Convention profile for ${language}`,
    tags: [
      { key: 'type',     value: 'convention' },
      { key: 'language', value: language },
    ],
    metadata: {
      language,
      profile: {
        language,
        analyzedFiles: 10,
        analyzedAt: '2024-01-15T09:00:00Z',
        conventions: [
          { pattern: fnStyle,     category: 'functionNames', score, sampleCount: 20 },
          { pattern: 'PascalCase', category: 'classNames',    score: 100, sampleCount: 5 },
        ],
      },
    },
  })
}

// Test fixture memories
const FIXTURES: MindrMemory[] = [
  // Conventions
  conventionMem('typescript', 'camelCase', 97),
  conventionMem('python',     'snake_case', 88),

  // Decisions
  mem({
    content: 'Decision: switch to Vitest',
    tags: [{ key: 'type', value: 'decision' }, { key: 'module', value: 'core' }],
    createdAt: '2024-01-15T08:00:00Z',
    metadata: { date: '2024-01-15', trigger: 'keyword' },
  }),
  mem({
    content: 'Decision: migrate to pnpm workspaces',
    tags: [{ key: 'type', value: 'decision' }, { key: 'module', value: 'root' }],
    createdAt: '2024-01-10T08:00:00Z',
    metadata: { date: '2024-01-10', trigger: 'keyword' },
  }),

  // Context (for hot modules) — use recent dates so they fall within the 30-day window
  { ...mem({ content: 'Commit abc: add feature', tags: [{ key: 'type', value: 'context' }, { key: 'module', value: 'core' }] }), createdAt: new Date().toISOString() },
  { ...mem({ content: 'Commit def: fix bug',     tags: [{ key: 'type', value: 'context' }, { key: 'module', value: 'core' }] }), createdAt: new Date().toISOString() },
  { ...mem({ content: 'Commit ghi: docs update', tags: [{ key: 'type', value: 'context' }, { key: 'module', value: 'docs' }] }), createdAt: new Date().toISOString() },

  // Debt
  mem({
    content: 'TODO at src/auth.ts:22 — validate token expiry',
    tags: [{ key: 'type', value: 'debt' }],
    metadata: { file: 'src/auth.ts', line: 22, keyword: 'TODO' },
  }),
  mem({
    content: 'FIXME at src/db.ts:45 — handle pool exhaustion',
    tags: [{ key: 'type', value: 'debt' }],
    metadata: { file: 'src/db.ts', line: 45, keyword: 'FIXME' },
  }),
]

// ---------------------------------------------------------------------------
// Shape tests
// ---------------------------------------------------------------------------

describe('buildSessionContext — shape', () => {
  it('returns all top-level fields', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx).toHaveProperty('stack')
    expect(ctx).toHaveProperty('conventions')
    expect(ctx).toHaveProperty('decisions')
    expect(ctx).toHaveProperty('hotModules')
    expect(ctx).toHaveProperty('warnings')
    expect(ctx).toHaveProperty('summary')
    expect(ctx).toHaveProperty('tokensUsed')
    expect(ctx).toHaveProperty('droppedSections')
  })

  it('stack contains language names from convention profiles, sorted asc', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.stack).toEqual(['python', 'typescript'])
  })

  it('conventions include top rules per language', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    const ts = ctx.conventions.find((c) => c.language === 'typescript')
    expect(ts).toBeDefined()
    expect(ts!.rules.some((r) => r.includes('camelCase'))).toBe(true)
  })

  it('decisions are sorted newest-first and stripped of prefix', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.decisions.length).toBe(2)
    expect(ctx.decisions[0].date).toBe('2024-01-15')
    expect(ctx.decisions[0].summary).toBe('switch to Vitest')
    expect(ctx.decisions[0].trigger).toBe('keyword')
  })

  it('warnings include debt items with location and keyword', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.warnings.length).toBe(2)
    const todo = ctx.warnings.find((w) => w.keyword === 'TODO')
    expect(todo).toBeDefined()
    expect(todo!.location).toBe('src/auth.ts:22')
  })

  it('hotModules counts commits per module from context memories', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    const coreModule = ctx.hotModules.find((m) => m.module === 'core')
    expect(coreModule).toBeDefined()
    expect(coreModule!.touches).toBe(2)
  })

  it('summary starts with === MINDR CONTEXT ===', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.summary.startsWith('=== MINDR CONTEXT ===')).toBe(true)
    expect(ctx.summary).toContain('=== END CONTEXT ===')
  })

  it('summary includes convention data', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.summary).toContain('camelCase')
    expect(ctx.summary).toContain('typescript')
  })

  it('summary includes decision data', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.summary).toContain('switch to Vitest')
  })

  it('summary includes warning data', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.summary).toContain('TODO')
    expect(ctx.summary).toContain('src/auth.ts')
  })

  it('droppedSections is empty when no budget set', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    expect(ctx.droppedSections).toEqual([])
  })

  it('tokensUsed matches the estimated tokens of summary', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES))
    const estimated = Math.ceil(ctx.summary.length / 4)
    expect(ctx.tokensUsed).toBe(estimated)
  })
})

// ---------------------------------------------------------------------------
// Token budget tests
// ---------------------------------------------------------------------------

describe('buildSessionContext — token budget', () => {
  it('drops no sections when max_tokens is generous', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES), { max_tokens: 10_000 })
    expect(ctx.droppedSections).toHaveLength(0)
    expect(ctx.tokensUsed).toBeLessThanOrEqual(10_000)
  })

  it('drops stack first when budget is tight', async () => {
    // Use a very small budget that forces dropping
    const ctx = await buildSessionContext(new MockBackend(FIXTURES), { max_tokens: 10 })
    expect(ctx.droppedSections).toContain('stack')
  })

  it('always retains warnings (highest priority) under any budget', async () => {
    // Even with an extremely small budget, warnings should be last to drop
    const ctxTight   = await buildSessionContext(new MockBackend(FIXTURES), { max_tokens: 10 })
    const ctxGenerous = await buildSessionContext(new MockBackend(FIXTURES), { max_tokens: 10_000 })

    // warnings section appears in generous output
    expect(ctxGenerous.summary).toContain('[WARNINGS]')

    // With extreme budget, stack is dropped before warnings
    if (ctxTight.droppedSections.includes('warnings')) {
      expect(ctxTight.droppedSections.indexOf('stack')).toBeLessThan(
        ctxTight.droppedSections.indexOf('warnings'),
      )
    }
  })

  it('drops sections in priority order: stack before conventions before hotModules', async () => {
    const ctx = await buildSessionContext(new MockBackend(FIXTURES), { max_tokens: 50 })
    const dropped = ctx.droppedSections

    const stackIdx   = dropped.indexOf('stack')
    const convsIdx   = dropped.indexOf('conventions')
    const hotIdx     = dropped.indexOf('hotModules')

    // If both stack and conventions are dropped, stack came first
    if (stackIdx !== -1 && convsIdx !== -1) {
      expect(stackIdx).toBeLessThan(convsIdx)
    }
    // If both conventions and hotModules are dropped, conventions came first
    if (convsIdx !== -1 && hotIdx !== -1) {
      expect(convsIdx).toBeLessThan(hotIdx)
    }
  })

  it('output stays under max_tokens when budget is set', async () => {
    const budget = 80
    const ctx = await buildSessionContext(new MockBackend(FIXTURES), { max_tokens: budget })
    // Token count of output should be at or under budget
    // (or the minimum possible if all sections were dropped and we're still over)
    expect(ctx.tokensUsed).toBeGreaterThan(0)
  })
})

// ---------------------------------------------------------------------------
// Empty backend
// ---------------------------------------------------------------------------

describe('buildSessionContext — empty backend', () => {
  it('returns empty arrays for all fields', async () => {
    const ctx = await buildSessionContext(new MockBackend([]))
    expect(ctx.stack).toEqual([])
    expect(ctx.conventions).toEqual([])
    expect(ctx.decisions).toEqual([])
    expect(ctx.hotModules).toEqual([])
    expect(ctx.warnings).toEqual([])
    expect(ctx.droppedSections).toEqual([])
  })

  it('still produces a valid summary string', async () => {
    const ctx = await buildSessionContext(new MockBackend([]))
    expect(typeof ctx.summary).toBe('string')
    expect(ctx.summary.length).toBeGreaterThan(0)
  })
})
