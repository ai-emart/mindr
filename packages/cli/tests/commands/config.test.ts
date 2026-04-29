import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Command } from 'commander'
import { addConfigCommands } from '../../src/commands/config.js'
import { captureStdout } from '../helpers/mock-backend.js'

describe('mindr config get/set', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = join(tmpdir(), `mindr-test-cfg-${Date.now()}-${Math.random().toString(36).slice(2)}`)
    mkdirSync(join(tmpDir, '.mindr'), { recursive: true })
    writeFileSync(
      join(tmpDir, '.mindr', 'config.toml'),
      '[storage]\nbackend = "sqlite"\nsqlite_path = ".mindr/mindr.sqlite"\n',
    )
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('config get reads a dotted key', async () => {
    const program = new Command().exitOverride()
    addConfigCommands(program, { repoRoot: tmpDir })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'config', 'get', 'storage.backend']),
    )
    expect(out.trim()).toBe('sqlite')
  })

  it('config set writes a value readable by config get', async () => {
    // Set
    const p1 = new Command().exitOverride()
    addConfigCommands(p1, { repoRoot: tmpDir })
    await p1.parseAsync(['node', 'mindr', 'config', 'set', 'storage.backend', 'remembr'])

    // Get
    const p2 = new Command().exitOverride()
    addConfigCommands(p2, { repoRoot: tmpDir })
    const out = await captureStdout(() =>
      p2.parseAsync(['node', 'mindr', 'config', 'get', 'storage.backend']),
    )
    expect(out.trim()).toBe('remembr')
  })

  it('config set creates nested keys that did not exist', async () => {
    const p1 = new Command().exitOverride()
    addConfigCommands(p1, { repoRoot: tmpDir })
    await p1.parseAsync([
      'node', 'mindr', 'config', 'set', 'remembr.base_url', 'https://example.com',
    ])

    const p2 = new Command().exitOverride()
    addConfigCommands(p2, { repoRoot: tmpDir })
    const out = await captureStdout(() =>
      p2.parseAsync(['node', 'mindr', 'config', 'get', 'remembr.base_url']),
    )
    expect(out.trim()).toBe('https://example.com')
  })

  it('config set prints confirmation', async () => {
    const program = new Command().exitOverride()
    addConfigCommands(program, { repoRoot: tmpDir })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'config', 'set', 'project_name', 'my-app']),
    )
    expect(out).toContain('project_name')
    expect(out).toContain('my-app')
  })

  it('config get throws on unknown key', async () => {
    const program = new Command().exitOverride()
    addConfigCommands(program, { repoRoot: tmpDir })
    await expect(
      program.parseAsync(['node', 'mindr', 'config', 'get', 'nonexistent.key']),
    ).rejects.toThrow()
  })
})
