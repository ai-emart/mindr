import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { installPostCommitHook, uninstallPostCommitHook } from '../../src/git/hooks.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'mindr-hooks-'))
  mkdirSync(join(tmpDir, '.git', 'hooks'), { recursive: true })
})

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true })
})

const hookFile = () => join(tmpDir, '.git', 'hooks', 'post-commit')

describe('installPostCommitHook', () => {
  it('creates the hook file with a shebang and the mindr command', () => {
    installPostCommitHook(tmpDir)
    expect(existsSync(hookFile())).toBe(true)
    const content = readFileSync(hookFile(), 'utf8')
    expect(content).toContain('#!/bin/sh')
    expect(content).toContain('mindr internal on-commit')
  })

  it('is idempotent — running twice produces exactly one mindr block', () => {
    installPostCommitHook(tmpDir)
    installPostCommitHook(tmpDir)
    const content = readFileSync(hookFile(), 'utf8')
    const blocks = content.match(/# >>> mindr-begin <<</g)
    expect(blocks?.length).toBe(1)
  })

  it('preserves pre-existing hook content', () => {
    writeFileSync(hookFile(), '#!/bin/sh\necho "existing hook"\n')
    installPostCommitHook(tmpDir)
    const content = readFileSync(hookFile(), 'utf8')
    expect(content).toContain('echo "existing hook"')
    expect(content).toContain('mindr internal on-commit')
  })

  it('writes LF line endings regardless of platform', () => {
    installPostCommitHook(tmpDir)
    const raw = readFileSync(hookFile())
    expect(raw.includes(Buffer.from('\r\n'))).toBe(false)
  })
})

describe('uninstallPostCommitHook', () => {
  it('removes the mindr block leaving existing content intact', () => {
    writeFileSync(hookFile(), '#!/bin/sh\necho "existing"\n')
    installPostCommitHook(tmpDir)
    uninstallPostCommitHook(tmpDir)
    const content = readFileSync(hookFile(), 'utf8')
    expect(content).not.toContain('mindr internal on-commit')
    expect(content).toContain('echo "existing"')
  })

  it('is a no-op when mindr was never installed', () => {
    writeFileSync(hookFile(), '#!/bin/sh\necho "other"\n')
    uninstallPostCommitHook(tmpDir)
    const content = readFileSync(hookFile(), 'utf8')
    expect(content).toContain('echo "other"')
  })

  it('is a no-op when the hook file does not exist', () => {
    expect(() => uninstallPostCommitHook(tmpDir)).not.toThrow()
  })
})
