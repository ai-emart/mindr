import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { addForgetCommand } from '../../src/commands/forget.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'
import type { MindrMemory } from '@ai-emart/mindr-core'

const SEED: MindrMemory[] = [
  {
    id: 'mem-abc',
    role: 'user',
    content: 'some memory',
    tags: [],
    metadata: null,
    sessionId: null,
    createdAt: new Date().toISOString(),
  },
]

describe('mindr forget', () => {
  it('calls backend.forget with the given id', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addForgetCommand(program, { backend })
    await program.parseAsync(['node', 'mindr', 'forget', 'mem-abc'])
    expect(backend.hasForgotten('mem-abc')).toBe(true)
  })

  it('prints confirmation to stdout', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addForgetCommand(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'forget', 'mem-abc']),
    )
    expect(out).toContain('Forgot memory')
    expect(out).toContain('mem-abc')
  })
})
