import { describe, it, expect, afterEach } from 'vitest'
import { simpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { onCommit, computeConfidence, extractRationale } from '../../src/git/watcher.js'
import type { DecisionTrigger } from '../../src/git/watcher.js'
import { SqliteBackend } from '../../src/storage/sqlite-backend.js'
import type { MindrConfig } from '../../src/config.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanups) fn()
  cleanups.length = 0
})

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mindr-conf-'))
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
  cleanups.push(() => {
    try {
      backend.close()
    } catch {
      /* ignore */
    }
    try {
      rmSync(dbDir, { recursive: true, force: true })
    } catch {
      /* ignore */
    }
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

async function commit(
  dir: string,
  files: Record<string, string>,
  message: string,
): Promise<string> {
  const git = simpleGit({ baseDir: dir })
  for (const [p, content] of Object.entries(files)) {
    write(dir, p, content)
    await git.add(p)
  }
  await git.commit(message)
  return (await git.revparse(['HEAD'])).trim()
}

// ---------------------------------------------------------------------------
// Unit tests for pure functions (no git required)
// ---------------------------------------------------------------------------

describe('computeConfidence', () => {
  it('single keyword trigger → 0.40', () => {
    expect(computeConfidence(['keyword'])).toBe(0.4)
  })

  it('single dependency-change trigger → 0.15', () => {
    expect(computeConfidence(['dependency-change'])).toBe(0.15)
  })

  it('keyword + dependency-change → 0.55', () => {
    expect(computeConfidence(['keyword', 'dependency-change'])).toBe(0.55)
  })

  it('keyword + large-cross-module-diff → 0.65', () => {
    expect(computeConfidence(['keyword', 'large-cross-module-diff'])).toBe(0.65)
  })

  it('all five triggers clamped to 1.00', () => {
    const all: DecisionTrigger[] = [
      'keyword',
      'large-cross-module-diff',
      'new-top-level-dir',
      'dependency-change',
      'import-pattern-change',
    ]
    expect(computeConfidence(all)).toBe(1)
  })

  it('empty triggers → 0', () => {
    expect(computeConfidence([])).toBe(0)
  })

  it('is deterministic — same input always produces the same score', () => {
    const triggers: DecisionTrigger[] = ['keyword', 'new-top-level-dir']
    const results = Array.from({ length: 10 }, () => computeConfidence(triggers))
    expect(new Set(results).size).toBe(1)
  })
})

describe('extractRationale', () => {
  it('returns null for a single-line message', () => {
    expect(extractRationale('feat: add login')).toBeNull()
  })

  it('returns null when body is only blank lines', () => {
    expect(extractRationale('feat: add login\n\n')).toBeNull()
  })

  it('extracts the body after a blank separator', () => {
    const msg = 'feat: add login\n\nWe need OAuth for SSO compliance.'
    expect(extractRationale(msg)).toBe('We need OAuth for SSO compliance.')
  })

  it('trims leading/trailing whitespace from the body', () => {
    const msg = 'fix: crash\n\n   Fixes a race condition.   '
    expect(extractRationale(msg)).toBe('Fixes a race condition.')
  })

  it('preserves multi-paragraph bodies', () => {
    const msg = 'refactor: auth\n\nFirst paragraph.\n\nSecond paragraph.'
    expect(extractRationale(msg)).toBe('First paragraph.\n\nSecond paragraph.')
  })
})

// ---------------------------------------------------------------------------
// Integration tests — real git commits
// ---------------------------------------------------------------------------

describe('onCommit — confidence in metadata', () => {
  it('keyword trigger stores confidence >= 0.40 in metadata', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'src/app.ts': 'const x = 1\n' }, 'refactor auth module')
    await onCommit(dir, sha, backend)
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(decisions).toHaveLength(1)
    const confidence = decisions[0]!.metadata?.confidence as number
    expect(typeof confidence).toBe('number')
    expect(confidence).toBeGreaterThanOrEqual(0.4)
    expect(confidence).toBeLessThanOrEqual(1)
  })

  it('dependency-change trigger stores confidence 0.15', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    await commit(dir, { 'README.md': '# Root\n' }, 'init')
    const sha = await commit(
      dir,
      { 'package.json': '{"name":"test","dependencies":{"lodash":"^4"}}\n' },
      'add lodash',
    )
    await onCommit(dir, sha, backend)
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(decisions).toHaveLength(1)
    expect(decisions[0]!.metadata?.confidence).toBe(0.15)
  })

  it('confidence is deterministic across two identical-trigger commits', async () => {
    const { dir: dir1 } = await initRepo()
    const { dir: dir2 } = await initRepo()
    const backend1 = makeSqliteBackend()
    const backend2 = makeSqliteBackend()

    const sha1 = await commit(dir1, { 'a.ts': 'const x = 1\n' }, 'decided to use ESM')
    const sha2 = await commit(dir2, { 'a.ts': 'const x = 1\n' }, 'decided to use ESM')

    await onCommit(dir1, sha1, backend1)
    await onCommit(dir2, sha2, backend2)

    const [d1] = await backend1.listByTags([{ key: 'type', value: 'decision' }])
    const [d2] = await backend2.listByTags([{ key: 'type', value: 'decision' }])
    expect(d1!.metadata?.confidence).toBe(d2!.metadata?.confidence)
  })

  it('stores triggers array in metadata', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'src/app.ts': 'const x = 1\n' }, 'migrate to postgres')
    await onCommit(dir, sha, backend)
    const [d] = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(Array.isArray(d!.metadata?.triggers)).toBe(true)
    expect((d!.metadata?.triggers as string[]).includes('keyword')).toBe(true)
  })

  it('stores filesAffected listing committed files', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(
      dir,
      { 'src/a.ts': 'export {}\n', 'src/b.ts': 'export {}\n' },
      'refactor to split modules',
    )
    await onCommit(dir, sha, backend)
    const [d] = await backend.listByTags([{ key: 'type', value: 'decision' }])
    const files = d!.metadata?.filesAffected as string[]
    expect(Array.isArray(files)).toBe(true)
    expect(files.some((f) => f.includes('a.ts'))).toBe(true)
    expect(files.some((f) => f.includes('b.ts'))).toBe(true)
  })

  it('rationale is extracted from multi-line commit message', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    // simple-git commit with body via array
    const git = simpleGit({ baseDir: dir })
    write(dir, 'src/main.ts', 'export const main = () => {}\n')
    await git.add('src/main.ts')
    await git.commit(['decided to use FastAPI', '', 'Python ecosystem is stronger for ML tasks.'])
    const sha = (await git.revparse(['HEAD'])).trim()

    await onCommit(dir, sha, backend)
    const [d] = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(d!.metadata?.rationale).toContain('Python ecosystem')
  })

  it('rationale is null for a single-line commit message', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()
    const sha = await commit(dir, { 'src/x.ts': 'const x = 1\n' }, 'chose TypeScript over Flow')
    await onCommit(dir, sha, backend)
    const [d] = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(d!.metadata?.rationale).toBeNull()
  })
})

describe('onCommit — import-pattern trigger', () => {
  it('5+ files with changed imports trigger import-pattern-change', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()

    // Create 5 files each importing from a new path
    const files: Record<string, string> = {}
    for (let i = 0; i < 5; i++) {
      files[`src/mod${i}.ts`] = `import { utils } from './utils${i}.js'\nexport const x${i} = utils\n`
    }
    const sha = await commit(dir, files, 'switch all modules to named imports')
    await onCommit(dir, sha, backend)

    const [d] = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(d).toBeDefined()
    const triggers = d!.metadata?.triggers as string[]
    expect(triggers).toContain('import-pattern-change')
  })

  it('fewer than 5 files with import changes do not trigger import-pattern-change', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()

    // Only 3 files with import changes — below the threshold
    const files: Record<string, string> = {}
    for (let i = 0; i < 3; i++) {
      files[`src/mod${i}.ts`] = `import { x } from './x${i}.js'\nexport const y${i} = x\n`
    }
    const sha = await commit(dir, files, 'update some imports')
    await onCommit(dir, sha, backend)

    // No keyword, no dep change, no new dir, not large — should be zero decisions
    const decisions = await backend.listByTags([{ key: 'type', value: 'decision' }])
    if (decisions.length > 0) {
      // If a decision was created, it must not have import-pattern-change in triggers
      const triggers = decisions[0]!.metadata?.triggers as string[]
      expect(triggers).not.toContain('import-pattern-change')
    }
  })
})

describe('onCommit — versionDiffs for dependency changes', () => {
  it('captures version diffs when package.json versions change', async () => {
    const { dir } = await initRepo()
    const backend = makeSqliteBackend()

    // Use prettified JSON — real package.json files are prettified, and the diff
    // needs each dependency on its own line for regex extraction to work.
    const pkg17 = JSON.stringify({ name: 'app', dependencies: { react: '^17.0.0' } }, null, 2)
    const pkg18 = JSON.stringify({ name: 'app', dependencies: { react: '^18.0.0' } }, null, 2)

    await commit(dir, { 'package.json': pkg17 + '\n' }, 'init')
    const sha = await commit(dir, { 'package.json': pkg18 + '\n' }, 'decided to upgrade react to v18')
    await onCommit(dir, sha, backend)

    const [d] = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(d).toBeDefined()
    const vd = d!.metadata?.versionDiffs as Record<string, { from: string; to: string }>
    expect(vd).toBeDefined()
    expect(vd['react']).toEqual({ from: '^17.0.0', to: '^18.0.0' })
  })
})
