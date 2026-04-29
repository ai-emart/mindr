import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { addStatusCommand } from '../../src/commands/status.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'
import type { MindrMemory, MindrConfig } from '@ai-emart/mindr-core'

const config: MindrConfig = {
  storage: { backend: 'sqlite', sqlite_path: '.mindr/mindr.sqlite' },
  remembr: {},
  embeddings: {},
}

function makeMem(type: string): MindrMemory {
  return {
    id: `mem-${type}`,
    role: 'system',
    content: `a ${type}`,
    tags: [{ key: 'type', value: type }],
    metadata: null,
    sessionId: null,
    createdAt: new Date().toISOString(),
  }
}

describe('mindr status', () => {
  it('shows the backend type', async () => {
    const backend = new MockBackend([makeMem('decision')])
    const program = new Command().exitOverride()
    addStatusCommand(program, { backend, config })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'status']),
    )
    expect(out).toContain('sqlite')
  })

  it('shows all memory type labels', async () => {
    const backend = new MockBackend([makeMem('decision'), makeMem('debt')])
    const program = new Command().exitOverride()
    addStatusCommand(program, { backend, config })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'status']),
    )
    expect(out).toContain('decision')
    expect(out).toContain('debt')
  })

  it('shows hook status label', async () => {
    const backend = new MockBackend([])
    const program = new Command().exitOverride()
    addStatusCommand(program, { backend, config })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'status']),
    )
    expect(out).toContain('hook')
  })

  it('shows memory counts', async () => {
    const seed: MindrMemory[] = [makeMem('decision'), makeMem('decision'), makeMem('debt')]
    const backend = new MockBackend(seed)
    const program = new Command().exitOverride()
    addStatusCommand(program, { backend, config })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'status']),
    )
    // Two decision memories → count of 2 should appear
    expect(out).toMatch(/decision\s+2/)
  })
})
