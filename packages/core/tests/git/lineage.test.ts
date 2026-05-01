import { describe, it, expect, afterEach } from 'vitest'
import { simpleGit } from 'simple-git'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { onCommit } from '../../src/git/watcher.js'
import { reachableCommits, branchMemoryQuery } from '../../src/git/lineage.js'
import { SqliteBackend } from '../../src/storage/sqlite-backend.js'
import type { MindrConfig } from '../../src/config.js'

const cleanups: Array<() => void> = []

afterEach(() => {
  for (const fn of cleanups) fn()
  cleanups.length = 0
})

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mindr-lin-'))
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
    try { backend.close() } catch { /* ignore */ }
    try { rmSync(dbDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })
  return backend
}

function write(base: string, relPath: string, content: string): void {
  const full = join(base, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

async function initRepo(dir: string): Promise<void> {
  const git = simpleGit({ baseDir: dir })
  await git.init()
  await git.addConfig('user.name', 'Tester')
  await git.addConfig('user.email', 'tester@example.com')
  // Create initial commit to establish a branch
  write(dir, '.gitkeep', '')
  await git.add('.gitkeep')
  await git.commit('init')
  // Ensure we're on main branch (checkout -b creates or switches to main)
  await git.checkout(['-b', 'main'])
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
// Scenario 1: Branch visibility
// Feature-branch memories visible from feature (by SHA).
// Main memories visible from both (parent SHA reachable from feature).
// Feature memories NOT visible from main.
// ---------------------------------------------------------------------------

describe('Branch visibility', () => {
  it('feature-branch memories are visible from feature but not from main', async () => {
    const dir = tempDir()
    await initRepo(dir)
    const git = simpleGit({ baseDir: dir })
    const backend = makeSqliteBackend()

    // Commit on main
    const mainSha = await commit(dir, { 'README.md': '# Main\n' }, 'decided to use TypeScript')
    await onCommit(dir, mainSha, backend)

    // Create and switch to feature branch
    await git.checkoutLocalBranch('feature/auth')

    // Commit on feature
    const featureSha = await commit(
      dir,
      { 'src/auth.ts': 'export const auth = true\n' },
      'decided to use JWT for auth',
    )
    await onCommit(dir, featureSha, backend)

    // SHAs reachable from feature (includes both commits — feature is a superset of main)
    const featureCommits = await reachableCommits(dir, 'feature/auth')
    // SHAs reachable from main (only the initial commit)
    const mainCommits = await reachableCommits(dir, 'main')

    expect(featureCommits).toContain(featureSha)
    expect(featureCommits).toContain(mainSha)
    expect(mainCommits).toContain(mainSha)
    expect(mainCommits).not.toContain(featureSha)

    // feature/auth branch scope finds both memories
    const fromFeature = await backend.searchByCommitSet(featureCommits, ['feature/auth'])
    const fromFeatureIds = fromFeature.map((m) => m.tags.find((t) => t.key === 'git_commit')?.value)
    expect(fromFeatureIds).toContain(mainSha)
    expect(fromFeatureIds).toContain(featureSha)

    // main branch scope does NOT find the feature memory
    const fromMain = await backend.searchByCommitSet(mainCommits, ['main'])
    const fromMainIds = fromMain.map((m) => m.tags.find((t) => t.key === 'git_commit')?.value)
    expect(fromMainIds).toContain(mainSha)
    expect(fromMainIds).not.toContain(featureSha)
  })

  it('branchMemoryQuery returns the branch as lineageFallback', async () => {
    const dir = tempDir()
    await initRepo(dir)
    await commit(dir, { 'a.ts': 'const a = 1\n' }, 'init')
    const query = await branchMemoryQuery(dir, 'main')
    expect(query.lineageFallback).toEqual(['main'])
    expect(Array.isArray(query.commits)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scenario 2: Squash-merge lineage fallback
// Memories from a feature branch are findable via branch_lineage after a
// squash-merge that discards the original commit SHAs.
// ---------------------------------------------------------------------------

describe('Squash-merge lineage fallback', () => {
  it('memories from squashed feature commits are found via branch_lineage tag', async () => {
    const dir = tempDir()
    await initRepo(dir)
    const git = simpleGit({ baseDir: dir })
    const backend = makeSqliteBackend()

    // Base commit on main
    await commit(dir, { 'README.md': '# project\n' }, 'init')

    // Feature branch with a decision commit
    await git.checkoutLocalBranch('feature/db')
    const featureSha = await commit(
      dir,
      { 'src/db.ts': 'export const db = null\n' },
      'decided to migrate to postgres',
    )
    await onCommit(dir, featureSha, backend)

    // Squash-merge back to main: create a new commit on main that is NOT featureSha.
    await git.checkout('main')
    write(dir, 'src/db.ts', 'export const db = null\n')
    await git.add('src/db.ts')
    await git.commit('squash: db changes from feature/db')
    const squashSha = (await git.revparse(['HEAD'])).trim()

    // featureSha is NOT in main's reachable set
    const mainCommits = await reachableCommits(dir, 'main')
    expect(mainCommits).toContain(squashSha)
    expect(mainCommits).not.toContain(featureSha)

    // Without lineage fallback: the feature decision is NOT found from main
    const withoutFallback = await backend.searchByCommitSet(mainCommits, ['main'])
    const withoutIds = new Set(
      withoutFallback.map((m) => m.tags.find((t) => t.key === 'git_commit')?.value),
    )
    expect(withoutIds.has(featureSha)).toBe(false)

    // With lineage fallback for feature/db: the memory IS found
    const withFallback = await backend.searchByCommitSet(mainCommits, ['main', 'feature/db'])
    const withIds = new Set(
      withFallback.map((m) => m.tags.find((t) => t.key === 'git_commit')?.value),
    )
    expect(withIds.has(featureSha)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Scenario 3: Cherry-pick SHA reachability
// A memory's original SHA is only reachable from the branch where it was
// made. After cherry-pick, the new SHA on main is different.
// The memory remains findable via branch_lineage fallback.
// ---------------------------------------------------------------------------

describe('Cherry-pick SHA reachability', () => {
  it('memory from cherry-picked commit is findable via lineage fallback', async () => {
    const dir = tempDir()
    await initRepo(dir)
    const git = simpleGit({ baseDir: dir })
    const backend = makeSqliteBackend()

    // Base commit on main
    await commit(dir, { 'README.md': '# app\n' }, 'init')

    // Feature branch with a decision commit
    await git.checkoutLocalBranch('feature/api')
    const originalSha = await commit(
      dir,
      { 'src/api.ts': 'export const api = {}\n' },
      'decided to switch to tRPC',
    )
    await onCommit(dir, originalSha, backend)

    // Cherry-pick to main — creates a NEW sha
    await git.checkout('main')
    await git.raw(['cherry-pick', originalSha])
    const cherryPickedSha = (await git.revparse(['HEAD'])).trim()

    // Sanity: cherry-pick creates a different SHA
    expect(cherryPickedSha).not.toBe(originalSha)

    const mainCommits = await reachableCommits(dir, 'main')
    const featureCommits = await reachableCommits(dir, 'feature/api')

    // originalSha is in feature but not main (cherry-pick produces new SHA)
    expect(featureCommits).toContain(originalSha)
    expect(mainCommits).toContain(cherryPickedSha)
    expect(mainCommits).not.toContain(originalSha)

    // From feature: the memory is found by exact SHA
    const fromFeature = await backend.searchByCommitSet(featureCommits, ['feature/api'])
    expect(fromFeature.some((m) => m.tags.some((t) => t.key === 'git_commit' && t.value === originalSha))).toBe(true)

    // From main (no fallback): the memory is NOT found (originalSha not reachable)
    const fromMainNoFallback = await backend.searchByCommitSet(mainCommits, ['main'])
    expect(fromMainNoFallback.some((m) => m.tags.some((t) => t.key === 'git_commit' && t.value === originalSha))).toBe(false)

    // From main WITH feature/api lineage fallback: the memory IS found
    const fromMainWithFallback = await backend.searchByCommitSet(mainCommits, ['main', 'feature/api'])
    expect(fromMainWithFallback.some((m) => m.tags.some((t) => t.key === 'git_commit' && t.value === originalSha))).toBe(true)
  })
})
