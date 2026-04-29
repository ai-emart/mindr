import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { execSync } from 'child_process'
import { runInit } from '../../src/commands/init.js'
import { MockBackend } from '../helpers/mock-backend.js'

function makeGitDir(): string {
  const dir = join(tmpdir(), `mindr-test-init-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(dir, { recursive: true })
  execSync('git init', { cwd: dir, stdio: 'ignore' })
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' })
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' })
  return dir
}

describe('mindr init', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = makeGitDir()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('creates .mindr/config.toml', async () => {
    await runInit({
      repoRoot: tmpDir,
      answers: { backendChoice: 'sqlite' },
      backend: new MockBackend(),
      skipScan: true,
    })
    expect(existsSync(join(tmpDir, '.mindr', 'config.toml'))).toBe(true)
  })

  it('installs post-commit hook', async () => {
    await runInit({
      repoRoot: tmpDir,
      answers: { backendChoice: 'sqlite' },
      backend: new MockBackend(),
      skipScan: true,
    })
    const hookPath = join(tmpDir, '.git', 'hooks', 'post-commit')
    expect(existsSync(hookPath)).toBe(true)
    expect(readFileSync(hookPath, 'utf8')).toContain('mindr-begin')
  })

  it('is idempotent — running twice installs the hook block exactly once', async () => {
    const opts = {
      repoRoot: tmpDir,
      answers: { backendChoice: 'sqlite' as const },
      backend: new MockBackend(),
      skipScan: true,
    }
    await runInit(opts)
    await runInit(opts)
    const hook = readFileSync(join(tmpDir, '.git', 'hooks', 'post-commit'), 'utf8')
    const blockCount = (hook.match(/# >>> mindr-begin <<</g) ?? []).length
    expect(blockCount).toBe(1)
  })

  it('config file contains the chosen backend', async () => {
    await runInit({
      repoRoot: tmpDir,
      answers: { backendChoice: 'sqlite' },
      backend: new MockBackend(),
      skipScan: true,
    })
    const content = readFileSync(join(tmpDir, '.mindr', 'config.toml'), 'utf8')
    expect(content).toContain('sqlite')
  })

  it('throws when not a git repo', async () => {
    const plain = join(tmpdir(), `mindr-test-plain-${Date.now()}`)
    mkdirSync(plain, { recursive: true })
    try {
      await expect(
        runInit({ repoRoot: plain, answers: { backendChoice: 'sqlite' }, skipScan: true }),
      ).rejects.toThrow()
    } finally {
      rmSync(plain, { recursive: true, force: true })
    }
  })
})
