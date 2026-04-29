import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { addMemoryCommands } from '../../src/commands/memory.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'
import type { MindrMemory } from '@ai-emart/mindr-core'

function mem(id: string, type: string, module: string): MindrMemory {
  return {
    id,
    role: 'system',
    content: `Content for ${id}`,
    tags: [
      { key: 'type', value: type },
      { key: 'module', value: module },
    ],
    metadata: null,
    sessionId: null,
    createdAt: new Date().toISOString(),
  }
}

const SEED: MindrMemory[] = [
  mem('id-1', 'decision', 'root'),
  mem('id-2', 'debt', 'core'),
  mem('id-3', 'decision', 'auth'),
]

describe('mindr memory list', () => {
  it('prints memories as a table by default', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addMemoryCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'memory', 'list']),
    )
    expect(out).toContain('id-1')
    expect(out).toContain('decision')
  })

  it('--json outputs a valid JSON array', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addMemoryCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'memory', 'list', '--json']),
    )
    const parsed: unknown = JSON.parse(out)
    expect(Array.isArray(parsed)).toBe(true)
    expect((parsed as MindrMemory[]).length).toBe(3)
  })

  it('--type filters by type tag', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addMemoryCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'memory', 'list', '--type', 'debt', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.id).toBe('id-2')
  })

  it('--module filters by module tag', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addMemoryCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync([
        'node', 'mindr', 'memory', 'list',
        '--type', 'decision', '--module', 'root', '--json',
      ]),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.id).toBe('id-1')
  })

  it('prints "No memories found" when nothing matches', async () => {
    const backend = new MockBackend([])
    const program = new Command().exitOverride()
    addMemoryCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'memory', 'list']),
    )
    expect(out).toContain('No memories found')
  })

  it('--since filters by date', async () => {
    const old: MindrMemory = {
      id: 'old-1',
      role: 'system',
      content: 'old memory',
      tags: [],
      metadata: null,
      sessionId: null,
      createdAt: '2020-01-01T00:00:00Z',
    }
    const recent: MindrMemory = {
      id: 'new-1',
      role: 'system',
      content: 'recent memory',
      tags: [],
      metadata: null,
      sessionId: null,
      createdAt: new Date().toISOString(),
    }
    const backend = new MockBackend([old, recent])
    const program = new Command().exitOverride()
    addMemoryCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'memory', 'list', '--since', '2024-01-01', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.id).toBe('new-1')
  })
})
