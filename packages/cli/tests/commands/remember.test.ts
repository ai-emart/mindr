import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { addRememberCommand } from '../../src/commands/remember.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'

describe('mindr remember', () => {
  it('stores memory with the given content', async () => {
    const backend = new MockBackend()
    const program = new Command().exitOverride()
    addRememberCommand(program, { backend })
    await program.parseAsync(['node', 'mindr', 'remember', 'decided to use pnpm'])
    expect(backend.stored).toHaveLength(1)
    expect(backend.stored[0]!.content).toBe('decided to use pnpm')
  })

  it('attaches --type and --module as tags', async () => {
    const backend = new MockBackend()
    const program = new Command().exitOverride()
    addRememberCommand(program, { backend })
    await program.parseAsync([
      'node', 'mindr', 'remember', 'switch to pnpm',
      '--type', 'decision', '--module', 'root',
    ])
    const stored = backend.stored[0]!
    expect(stored.tags.some((t) => t.key === 'type' && t.value === 'decision')).toBe(true)
    expect(stored.tags.some((t) => t.key === 'module' && t.value === 'root')).toBe(true)
  })

  it('attaches extra --tag values (repeatable)', async () => {
    const backend = new MockBackend()
    const program = new Command().exitOverride()
    addRememberCommand(program, { backend })
    await program.parseAsync([
      'node', 'mindr', 'remember', 'tagged mem',
      '--tag', 'ticket:PROJ-99',
      '--tag', 'epic:auth',
    ])
    const stored = backend.stored[0]!
    expect(stored.tags.some((t) => t.key === 'ticket' && t.value === 'PROJ-99')).toBe(true)
    expect(stored.tags.some((t) => t.key === 'epic' && t.value === 'auth')).toBe(true)
  })

  it('prints confirmation to stdout', async () => {
    const backend = new MockBackend()
    const program = new Command().exitOverride()
    addRememberCommand(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'remember', 'hello']),
    )
    expect(out).toContain('Stored memory')
  })
})
