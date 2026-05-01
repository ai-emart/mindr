import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, writeFileSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Mindr } from '../src/index.js'
import type { MindrConfig } from '../src/index.js'
import * as sdk from '../src/index.js'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeTmpProject(): { projectDir: string; dbPath: string; config: MindrConfig } {
  const projectDir = join(
    tmpdir(),
    `mindr-sdk-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  )
  mkdirSync(projectDir, { recursive: true })
  // Minimal package.json so getProjectMeta works in regenerateAgentsMd tests
  writeFileSync(
    join(projectDir, 'package.json'),
    JSON.stringify({ name: 'test-project', version: '1.0.0' }),
  )

  const dbPath = join(projectDir, 'mindr.sqlite')
  const config: MindrConfig = {
    storage: { backend: 'sqlite', sqlite_path: dbPath },
    remembr: {},
    embeddings: {},
  }
  return { projectDir, dbPath, config }
}

// ---------------------------------------------------------------------------
// Public surface snapshot
// ---------------------------------------------------------------------------

describe('SDK public surface', () => {
  it('exports the expected named identifiers', () => {
    const names = Object.keys(sdk).sort()
    expect(names).toMatchSnapshot()
  })

  it('Mindr class exposes expected instance methods', () => {
    const methods = Object.getOwnPropertyNames(Mindr.prototype)
      .filter((m) => m !== 'constructor')
      .sort()
    expect(methods).toMatchSnapshot()
  })
})

// ---------------------------------------------------------------------------
// Per-method tests
// ---------------------------------------------------------------------------

describe('Mindr', () => {
  let mindr: Mindr
  let projectDir: string
  let dbPath: string

  beforeEach(async () => {
    const tmp = makeTmpProject()
    projectDir = tmp.projectDir
    dbPath = tmp.dbPath
    mindr = await Mindr.open({ project: projectDir, config: tmp.config })
  })

  afterEach(() => {
    mindr.close()
    rmSync(projectDir, { recursive: true, force: true })
  })

  // -------------------------------------------------------------------------
  // open / close
  // -------------------------------------------------------------------------

  it('Mindr.open returns a Mindr instance', () => {
    expect(mindr).toBeInstanceOf(Mindr)
  })

  it('close() releases the SQLite file handle (file still exists)', () => {
    mindr.close()
    // File should still be there — close() just releases the handle
    expect(existsSync(dbPath)).toBe(true)
    // Re-open to prevent afterEach from double-closing
    void Mindr.open({ project: projectDir, config: { storage: { backend: 'sqlite', sqlite_path: dbPath }, remembr: {}, embeddings: {} } })
      .then((m) => m.close())
  })

  // -------------------------------------------------------------------------
  // remember
  // -------------------------------------------------------------------------

  it('remember() stores a memory and returns it', async () => {
    const mem = await mindr.remember('We use tRPC for all internal APIs', {
      type: 'decision',
      module: 'api',
    })
    expect(mem.id).toBeTruthy()
    expect(mem.content).toBe('We use tRPC for all internal APIs')
  })

  it('remember() attaches type and module as tags', async () => {
    const mem = await mindr.remember('use ESM everywhere', {
      type: 'decision',
      module: 'root',
    })
    expect(mem.tags.some((t) => t.key === 'type' && t.value === 'decision')).toBe(true)
    expect(mem.tags.some((t) => t.key === 'module' && t.value === 'root')).toBe(true)
  })

  it('remember() attaches extra tags', async () => {
    const mem = await mindr.remember('tagged note', {
      tags: [{ key: 'ticket', value: 'PROJ-42' }],
    })
    expect(mem.tags.some((t) => t.key === 'ticket' && t.value === 'PROJ-42')).toBe(true)
  })

  it('remember() stores metadata', async () => {
    const meta = { date: '2024-01-15', trigger: 'manual' }
    const mem = await mindr.remember('a decision', { type: 'decision', metadata: meta })
    expect(mem.metadata).toEqual(meta)
  })

  // -------------------------------------------------------------------------
  // forget
  // -------------------------------------------------------------------------

  it('forget() removes the memory from subsequent query results', async () => {
    const mem = await mindr.remember('temporary note', { type: 'note' })
    await mindr.forget(mem.id)
    const results = await mindr.query({ type: 'note' })
    expect(results.find((m) => m.id === mem.id)).toBeUndefined()
  })

  // -------------------------------------------------------------------------
  // query
  // -------------------------------------------------------------------------

  it('query() returns all memories when no filter given', async () => {
    await mindr.remember('mem A', { type: 'decision' })
    await mindr.remember('mem B', { type: 'debt' })
    const all = await mindr.query({})
    expect(all.length).toBeGreaterThanOrEqual(2)
  })

  it('query() filters by type', async () => {
    await mindr.remember('decision only', { type: 'decision' })
    await mindr.remember('debt item', { type: 'debt' })
    const results = await mindr.query({ type: 'decision' })
    expect(results.every((m) => m.tags.some((t) => t.key === 'type' && t.value === 'decision'))).toBe(true)
  })

  it('query() filters by module', async () => {
    await mindr.remember('auth decision', { type: 'decision', module: 'auth' })
    await mindr.remember('api decision', { type: 'decision', module: 'api' })
    const results = await mindr.query({ type: 'decision', module: 'auth' })
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toBe('auth decision')
  })

  it('query() filters by since date', async () => {
    await mindr.remember('recent note', { type: 'note' })
    const results = await mindr.query({ type: 'note', since: new Date('2020-01-01') })
    expect(results.length).toBeGreaterThanOrEqual(1)

    const farFuture = await mindr.query({ type: 'note', since: new Date('2099-01-01') })
    expect(farFuture).toHaveLength(0)
  })

  it('query() respects limit', async () => {
    await Promise.all(
      Array.from({ length: 5 }, (_, i) => mindr.remember(`note ${i}`, { type: 'note' })),
    )
    const results = await mindr.query({ type: 'note', limit: 2 })
    expect(results.length).toBeLessThanOrEqual(2)
  })

  it('query() returns quality scores and breakdowns', async () => {
    await mindr.remember('quality note', { type: 'note' })
    const [result] = await mindr.query({ type: 'note', limit: 1 })
    expect(result!.qualityScore).toBeTypeOf('number')
    expect(result!.qualityBreakdown.total).toBe(result!.qualityScore)
  })

  // -------------------------------------------------------------------------
  // getDecisions
  // -------------------------------------------------------------------------

  it('getDecisions() returns Decision objects', async () => {
    await mindr.remember('Decision: use TypeScript', {
      type: 'decision',
      module: 'core',
      metadata: { date: '2024-01-01', trigger: 'keyword' },
    })
    const decisions = await mindr.getDecisions()
    expect(decisions.length).toBeGreaterThanOrEqual(1)
    const d = decisions.find((x) => x.summary === 'use TypeScript')
    expect(d).toBeDefined()
    expect(d!.summary).toBe('use TypeScript')
    expect(d!.module).toBe('core')
    expect(d!.trigger).toBe('keyword')
  })

  it('getDecisions() strips "Decision: " prefix from summary', async () => {
    await mindr.remember('Decision: switch to pnpm', {
      type: 'decision',
      metadata: { date: '2024-01-15' },
    })
    const decisions = await mindr.getDecisions()
    const d = decisions.find((x) => x.summary === 'switch to pnpm')
    expect(d).toBeDefined()
  })

  it('getDecisions() returns newest first', async () => {
    await mindr.remember('Decision: early choice', {
      type: 'decision',
      metadata: { date: '2023-01-01' },
    })
    await mindr.remember('Decision: recent choice', {
      type: 'decision',
      metadata: { date: '2024-06-01' },
    })
    const decisions = await mindr.getDecisions()
    expect(decisions[0]!.date >= decisions[1]!.date).toBe(true)
  })

  it('getDecisions() filters by module', async () => {
    await mindr.remember('Decision: auth thing', { type: 'decision', module: 'auth', metadata: { date: '2024-01-01' } })
    await mindr.remember('Decision: api thing', { type: 'decision', module: 'api', metadata: { date: '2024-01-01' } })
    const results = await mindr.getDecisions({ module: 'auth' })
    expect(results).toHaveLength(1)
    expect(results[0]!.module).toBe('auth')
  })

  it('getDecisions() filters by from date (future cutoff returns nothing)', async () => {
    await mindr.remember('Decision: early', { type: 'decision', metadata: { date: '2023-01-01' } })
    await mindr.remember('Decision: recent', { type: 'decision', metadata: { date: '2024-06-01' } })
    // All memories are created now, so a far-future cutoff returns nothing
    const results = await mindr.getDecisions({ from: new Date('2099-01-01') })
    expect(results).toHaveLength(0)
    // A past cutoff returns all
    const allResults = await mindr.getDecisions({ from: new Date('2020-01-01') })
    expect(allResults.length).toBeGreaterThanOrEqual(2)
  })

  it('getDecisions() filters by to date (past cutoff returns nothing)', async () => {
    await mindr.remember('Decision: past', { type: 'decision', metadata: { date: '2023-01-01' } })
    // All memories were created now, so a 2020 to-cutoff returns nothing
    const results = await mindr.getDecisions({ to: new Date('2020-01-01') })
    expect(results).toHaveLength(0)
  })

  it('getDecisions() exposes confidence, triggers, rationale, filesAffected', async () => {
    await mindr.remember('Decision: use ESM', {
      type: 'decision',
      metadata: {
        date: '2024-01-01',
        trigger: 'keyword',
        triggers: ['keyword', 'import-pattern-change'],
        confidence: 0.65,
        rationale: 'Better tree-shaking.',
        filesAffected: ['tsconfig.json', 'package.json'],
      },
    })
    const [d] = await mindr.getDecisions()
    expect(d!.trigger).toBe('keyword')
    expect(d!.triggers).toEqual(['keyword', 'import-pattern-change'])
    expect(d!.confidence).toBe(0.65)
    expect(d!.rationale).toBe('Better tree-shaking.')
    expect(d!.filesAffected).toEqual(['tsconfig.json', 'package.json'])
  })

  it('getDecisions() marks reversed decisions with reversed:true', async () => {
    const mem = await mindr.remember('Decision: old approach', { type: 'decision' })
    await mindr.remember(`Reversed decision ${mem.id}`, {
      tags: [
        { key: 'type', value: 'note' },
        { key: 'reversed_decision', value: 'true' },
        { key: 'original_decision', value: mem.id },
      ],
    })
    const results = await mindr.getDecisions()
    const d = results.find((x) => x.id === mem.id)
    expect(d?.reversed).toBe(true)
  })

  // -------------------------------------------------------------------------
  // getDebt
  // -------------------------------------------------------------------------

  it('getDebt() returns DebtItem objects with location', async () => {
    await mindr.remember('TODO at src/auth.ts:22 — fix token expiry', {
      type: 'debt',
      module: 'auth',
      metadata: { file: 'src/auth.ts', line: 22, keyword: 'TODO' },
    })
    const debt = await mindr.getDebt()
    expect(debt.length).toBeGreaterThanOrEqual(1)
    const item = debt.find((d) => d.keyword === 'TODO')
    expect(item).toBeDefined()
    expect(item!.location).toBe('src/auth.ts:22')
    expect(item!.file).toBe('src/auth.ts')
    expect(item!.line).toBe(22)
  })

  it('getDebt() filters by module', async () => {
    await mindr.remember('FIXME auth issue', { type: 'debt', module: 'auth', metadata: { file: 'a.ts', line: 1, keyword: 'FIXME' } })
    await mindr.remember('TODO api issue', { type: 'debt', module: 'api', metadata: { file: 'b.ts', line: 1, keyword: 'TODO' } })
    const results = await mindr.getDebt({ module: 'auth' })
    expect(results).toHaveLength(1)
    expect(results[0]!.module).toBe('auth')
  })

  it('getDebt() respects limit', async () => {
    await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        mindr.remember(`TODO issue ${i}`, { type: 'debt', metadata: { file: `f${i}.ts`, line: i, keyword: 'TODO' } }),
      ),
    )
    const results = await mindr.getDebt({ limit: 2 })
    expect(results).toHaveLength(2)
  })

  it('addDebt() stores a manual debt item', async () => {
    const item = await mindr.addDebt('Replace temporary retry loop', {
      file: 'src/billing/invoice.ts',
      severity: 'high',
    })
    expect(item.module).toBe('src')
    expect(item.severity).toBe('high')
    expect(item.file).toBe('src/billing/invoice.ts')
  })

  it('resolveDebt() stores a debt_resolved memory', async () => {
    const resolved = await mindr.resolveDebt('debt-123')
    expect(resolved.tags.some((t) => t.key === 'type' && t.value === 'debt_resolved')).toBe(true)
    expect(resolved.tags.some((t) => t.key === 'original_debt' && t.value === 'debt-123')).toBe(true)
  })

  // -------------------------------------------------------------------------
  // getConventions
  // -------------------------------------------------------------------------

  it('getConventions() returns ConventionProfile objects from stored memories', async () => {
    const profile = {
      language: 'typescript',
      analyzedFiles: 5,
      analyzedAt: new Date().toISOString(),
      conventions: [
        { pattern: 'camelCase', category: 'functionNames', score: 95, sampleCount: 10 },
      ],
    }
    await mindr.remember('Convention profile for typescript', {
      type: 'convention',
      tags: [{ key: 'language', value: 'typescript' }],
      metadata: { language: 'typescript', profile },
    })
    const conventions = await mindr.getConventions()
    expect(conventions).toHaveLength(1)
    expect(conventions[0]!.language).toBe('typescript')
    expect(conventions[0]!.conventions[0]!.pattern).toBe('camelCase')
  })

  it('getConventions() filters by language', async () => {
    const mkProfile = (lang: string) => ({
      language: lang,
      analyzedFiles: 3,
      analyzedAt: new Date().toISOString(),
      conventions: [{ pattern: 'camelCase', category: 'functionNames', score: 90, sampleCount: 5 }],
    })
    await mindr.remember('Convention profile for typescript', {
      type: 'convention',
      tags: [{ key: 'language', value: 'typescript' }],
      metadata: { language: 'typescript', profile: mkProfile('typescript') },
    })
    await mindr.remember('Convention profile for python', {
      type: 'convention',
      tags: [{ key: 'language', value: 'python' }],
      metadata: { language: 'python', profile: mkProfile('python') },
    })
    const tsOnly = await mindr.getConventions({ language: 'typescript' })
    expect(tsOnly).toHaveLength(1)
    expect(tsOnly[0]!.language).toBe('typescript')
  })

  // -------------------------------------------------------------------------
  // getSessionContext
  // -------------------------------------------------------------------------

  it('getSessionContext() returns a SessionContext with the canonical header', async () => {
    const ctx = await mindr.getSessionContext()
    expect(ctx.summary).toContain('=== MINDR CONTEXT ===')
    expect(ctx.summary).toContain('=== END CONTEXT ===')
  })

  it('getSessionContext() has all required fields', async () => {
    const ctx = await mindr.getSessionContext()
    expect(ctx).toHaveProperty('stack')
    expect(ctx).toHaveProperty('conventions')
    expect(ctx).toHaveProperty('decisions')
    expect(ctx).toHaveProperty('hotModules')
    expect(ctx).toHaveProperty('warnings')
    expect(ctx).toHaveProperty('tokensUsed')
    expect(ctx).toHaveProperty('droppedSections')
  })

  it('getSessionContext() includes stored decision data', async () => {
    await mindr.remember('Decision: use tRPC', {
      type: 'decision',
      metadata: { date: '2024-01-15', trigger: 'keyword' },
    })
    const ctx = await mindr.getSessionContext()
    expect(ctx.summary).toContain('use tRPC')
  })

  it('getSessionContext() respects max_tokens budget', async () => {
    const full = await mindr.getSessionContext()
    const trimmed = await mindr.getSessionContext({ max_tokens: 30 })
    expect(trimmed.summary.length).toBeLessThanOrEqual(full.summary.length)
  })

  it('getContextHealth() returns a score and recommendation', async () => {
    const result = await mindr.getContextHealth('session-1')
    expect(result.score).toBeGreaterThanOrEqual(0)
    expect(['ok', 'consider_checkpoint', 'recommend_fresh_session']).toContain(result.recommendation)
  })

  it('checkpointSession() stores a session_checkpoint memory', async () => {
    const checkpoint = await mindr.checkpointSession('session-1')
    expect(checkpoint.tags.some((t) => t.key === 'type' && t.value === 'session_checkpoint')).toBe(true)
  })

  it('getStats() returns token metering totals', async () => {
    await mindr.remember('metered', {
      tags: [{ key: 'type', value: 'metering' }, { key: 'session', value: 'session-1' }],
      metadata: { tokensInjected: 12, estimatedSaved: 20 },
    })
    const stats = await mindr.getStats({ session: 'session-1', last: '1d' })
    expect(stats.tokensInjected).toBe(12)
    expect(stats.range.high).toBe(20)
  })

  // -------------------------------------------------------------------------
  // getStatus
  // -------------------------------------------------------------------------

  it('getStatus() returns backendType and projectPath', async () => {
    const status = await mindr.getStatus()
    expect(status.backendType).toBe('sqlite')
    expect(status.projectPath).toBeTruthy()
  })

  it('getStatus() counts memories per type', async () => {
    await mindr.remember('a decision', { type: 'decision' })
    await mindr.remember('another decision', { type: 'decision' })
    await mindr.remember('a debt item', { type: 'debt' })
    const status = await mindr.getStatus()
    expect(status.memoryCounts['decision']).toBe(2)
    expect(status.memoryCounts['debt']).toBe(1)
  })

  it('getStatus() lists all memory types in memoryCounts', async () => {
    const status = await mindr.getStatus()
    for (const type of sdk.MEMORY_TYPES) {
      expect(status.memoryCounts).toHaveProperty(type)
    }
  })

  // -------------------------------------------------------------------------
  // regenerateAgentsMd
  // -------------------------------------------------------------------------

  it('regenerateAgentsMd() writes AGENTS.md and returns its content', async () => {
    const outPath = join(projectDir, 'AGENTS.md')
    const result = await mindr.regenerateAgentsMd({ agentsMdPath: outPath })
    expect(result.agentsMd).toBeTruthy()
    expect(result.agentsMd).toContain('<!-- mindr-generated -->')
    expect(existsSync(outPath)).toBe(true)
    expect(readFileSync(outPath, 'utf8')).toBe(result.agentsMd)
  })

  it('regenerateAgentsMd() target=claude-md generates CLAUDE.md', async () => {
    const outPath = join(projectDir, 'CLAUDE.md')
    const result = await mindr.regenerateAgentsMd({ target: 'claude-md', claudeMdPath: outPath })
    expect(result.claudeMd).toBeTruthy()
    expect(result.agentsMd).toBeUndefined()
    expect(existsSync(outPath)).toBe(true)
  })

  it('regenerateAgentsMd() target=all generates both files', async () => {
    const agentsPath = join(projectDir, 'AGENTS.md')
    const claudePath = join(projectDir, 'CLAUDE.md')
    const result = await mindr.regenerateAgentsMd({
      target: 'all',
      agentsMdPath: agentsPath,
      claudeMdPath: claudePath,
    })
    expect(result.agentsMd).toBeTruthy()
    expect(result.claudeMd).toBeTruthy()
    expect(existsSync(agentsPath)).toBe(true)
    expect(existsSync(claudePath)).toBe(true)
  })

})

// ---------------------------------------------------------------------------
// migrateSqliteToRemembr — isolated: uses its own DB so no shared handle
// ---------------------------------------------------------------------------

describe('Mindr.migrateSqliteToRemembr', () => {
  it('rejects without valid Remembr credentials', async () => {
    const { projectDir, dbPath } = makeTmpProject()
    const config: MindrConfig = {
      storage: { backend: 'sqlite', sqlite_path: dbPath },
      remembr: {},
      embeddings: {},
    }
    const m = await Mindr.open({ project: projectDir, config })
    try {
      await expect(m.migrateSqliteToRemembr()).rejects.toThrow()
    } finally {
      m.close()
      // Give Windows a moment to release WAL files before cleanup
      await new Promise((r) => setTimeout(r, 50))
      rmSync(projectDir, { recursive: true, force: true })
    }
  })
})
