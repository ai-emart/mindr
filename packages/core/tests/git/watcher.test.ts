import { describe, it, expect, afterEach } from 'vitest'
import { simpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { onCommit } from '../../src/git/watcher.js'
import { SqliteBackend } from '../../src/storage/sqlite-backend.js'
import type { MindrConfig } from '../../src/config.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanups) fn()
  cleanups.length = 0
})

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mindr-git-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function makeSqliteBackend(): SqliteBackend {
  const dbDir = mkdtempSync(join(tmpdir(), 'mindr-db-'))
  const config: MindrConfig = {
    remembr: {},
    storage: { backend: 'sqlite', sqlite_path: join(dbDir, 'test.sqlite') },
    embeddings: {},
  }
  const backend = new SqliteBackend(config)
  // Close DB first, then delete — order matters on Windows (WAL lock).
  cleanups.push(() => {
    try { backend.close() } catch { /* ignore */ }
    try { rmSync(dbDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })
  return backend
}

async function initRepo(): Promise<{ dir: string }> {
  const dir = tempDir()
  const git = simpleGit({ baseDir: dir })
  await git.init()
  await git.addConfig('user.name', 'Tester')
  await git.addConfig('user.email', 'tester@example.com')
  return { dir }
}

function write(base: string, relPath: string, content: string): void {
  const full = join(base, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

async function commit(dir: string, files: Record<string, string>, message: string): Promise<string> {
  const git = simpleGit({ baseDir: dir })
  for (const [p, content] of Object.entries(files)) {
    write(dir, p, content)
    await git.add(p)
  }
  await git.commit(message)
  return (await git.revparse(['HEAD'])).trim()
}

describe('onCommit — context memory', () => {
  it('always emits a context memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'README.md': '# Hello\n' }, 'Initial commit')
    const result = await onCommit(dir, sha, backend)
    expect(result.contextMemories).toBe(1)
    expect(result.memoriesCreated).toBeGreaterThanOrEqual(1)
    const all = await backend.listByTags([{ key: 'git_commit', value: sha }])
    expect(all.length).toBeGreaterThanOrEqual(1)
    expect(all.some((m) => m.content.includes(sha.slice(0, 8)))).toBe(true)
  })
})

describe('onCommit — decision triggers', () => {
  it('keyword "refactor" triggers a decision memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'src/app.ts': 'const x = 1\n' }, 'refactor auth module')
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(1)
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(decisions.length).toBe(1)
    expect(decisions[0].metadata?.trigger).toBe('keyword')
  })

  it('keyword "migrate" triggers a decision memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'db.ts': 'export {}\n' }, 'migrate database to postgres')
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(1)
  })

  it('keyword "decided" triggers a decision memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'notes.md': '# Note\n' }, 'decided to use ESM everywhere')
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(1)
  })

  it('large diff (>100 lines) across 2+ modules triggers a decision memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    // Generate files in two different top-level dirs with lots of lines each
    const bigContent = Array.from({ length: 60 }, (_, i) => `const line${i} = ${i}`).join('\n') + '\n'
    const sha = await commit(
      dir,
      { 'moduleA/index.ts': bigContent, 'moduleB/index.ts': bigContent },
      'large refactoring',
    )
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(1)
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    // Trigger may be keyword ("refactoring") or large-cross-module-diff — either is valid
    expect(['keyword', 'large-cross-module-diff']).toContain(decisions[0].metadata?.trigger)
  })

  it('new top-level directory triggers a decision memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    // First commit with no subdirs
    await commit(dir, { 'README.md': '# Root\n' }, 'init')
    // Second commit adds a new top-level dir
    const sha = await commit(dir, { 'infra/deploy.sh': '#!/bin/sh\necho deploy\n' }, 'add infra layer')
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(1)
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(decisions[0].metadata?.trigger).toBe('new-top-level-dir')
  })

  it('dependency file change (package.json) triggers a decision memory', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    await commit(dir, { 'README.md': '# Root\n' }, 'init')
    const sha = await commit(
      dir,
      { 'package.json': '{"name":"test","dependencies":{"lodash":"^4"}}\n' },
      'add lodash dependency',
    )
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(1)
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(decisions[0].metadata?.trigger).toBe('dependency-change')
  })

  it('plain commit with no triggers produces zero decision memories', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'src/util.ts': 'export const add = (a: number, b: number) => a + b\n' }, 'add util')
    const result = await onCommit(dir, sha, backend)
    expect(result.decisionMemories).toBe(0)
    expect(result.contextMemories).toBe(1)
  })
})

describe('onCommit — debt memories (TODO/FIXME/HACK/XXX)', () => {
  it('extracts a TODO added in a commit', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(
      dir,
      { 'src/parser.ts': 'export function parse() {\n  // TODO: handle edge cases\n  return null\n}\n' },
      'add parser stub',
    )
    const result = await onCommit(dir, sha, backend)
    expect(result.debtMemories).toBe(1)
    const debts = await backend.listByTags([{ key: 'type', value: 'debt' }])
    expect(debts.length).toBe(1)
    expect(debts[0].content).toContain('TODO')
  })

  it('extracts a FIXME added in a commit', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(
      dir,
      { 'src/auth.ts': 'export function login() {\n  // FIXME: validate token properly\n}\n' },
      'add login stub',
    )
    const result = await onCommit(dir, sha, backend)
    expect(result.debtMemories).toBe(1)
    const debts = await backend.listByTags([{ key: 'type', value: 'debt' }])
    expect(debts[0].content).toContain('FIXME')
  })

  it('extracts HACK and XXX in the same commit', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(
      dir,
      {
        'src/hack.ts':
          '// HACK: temporary workaround\n// XXX: must rewrite before release\nexport {}\n',
      },
      'add hacks',
    )
    const result = await onCommit(dir, sha, backend)
    expect(result.debtMemories).toBe(2)
  })

  it('emits zero debt memories when no TODO/FIXME/HACK/XXX are added', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(
      dir,
      { 'src/clean.ts': 'export const clean = () => "no issues"\n' },
      'clean code',
    )
    const result = await onCommit(dir, sha, backend)
    expect(result.debtMemories).toBe(0)
  })
})

describe('onCommit — context memory tags', () => {
  it('context memory carries git_commit tag matching the sha', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'file.ts': 'export {}\n' }, 'tagged commit')
    await onCommit(dir, sha, backend)
    const found = await backend.listByTags([{ key: 'git_commit', value: sha }])
    expect(found.length).toBe(1)
    expect(found[0].tags.some((t) => t.key === 'type' && t.value === 'context')).toBe(true)
  })
})
