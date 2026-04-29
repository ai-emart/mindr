import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import chalk from 'chalk'
import { addReplayCommands } from '../../src/commands/replay.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'
import type { MindrMemory } from '@ai-emart/mindr-core'

function makeDecision(
  id: string,
  module: string,
  summary: string,
  createdAt: string,
): MindrMemory {
  return {
    id,
    role: 'system',
    content: `Decision: ${summary}`,
    tags: [
      { key: 'type', value: 'decision' },
      { key: 'module', value: module },
    ],
    metadata: null,
    sessionId: null,
    createdAt,
  }
}

function makeReversedMarker(targetId: string): MindrMemory {
  return {
    id: `rev-${targetId}`,
    role: 'system',
    content: `Reversed decision ${targetId}`,
    tags: [
      { key: 'type', value: 'note' },
      { key: 'reversed_decision', value: 'true' },
      { key: 'original_decision', value: targetId },
    ],
    metadata: null,
    sessionId: null,
    createdAt: new Date().toISOString(),
  }
}

const SEED: MindrMemory[] = [
  makeDecision('d-1', 'auth', 'use JWT', '2024-01-15T00:00:00Z'),
  makeDecision('d-2', 'api', 'switch to tRPC', '2024-03-01T00:00:00Z'),
  makeDecision('d-3', 'auth', 'migrate to OAuth2', '2024-06-01T00:00:00Z'),
  makeDecision('d-4', 'infra', 'adopt Kubernetes', '2024-09-15T00:00:00Z'),
]

describe('mindr replay', () => {
  it('lists decisions in chronological order (oldest first)', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(4)
    for (let i = 1; i < parsed.length; i++) {
      expect(new Date(parsed[i]!.createdAt).getTime()).toBeGreaterThanOrEqual(
        new Date(parsed[i - 1]!.createdAt).getTime(),
      )
    }
    // First is oldest
    expect(parsed[0]!.id).toBe('d-1')
    expect(parsed[parsed.length - 1]!.id).toBe('d-4')
  })

  it('--module filters by module', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--module', 'auth', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(2)
    expect(parsed.every((m) => m.tags.some((t) => t.key === 'module' && t.value === 'auth'))).toBe(
      true,
    )
    // Still chronological
    expect(new Date(parsed[0]!.createdAt) <= new Date(parsed[1]!.createdAt)).toBe(true)
  })

  it('--from filters decisions on or after date', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--from', '2024-06-01', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.id).toBe('d-3')
    expect(parsed[1]!.id).toBe('d-4')
  })

  it('--to filters decisions on or before date', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--to', '2024-03-31', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.id).toBe('d-1')
    expect(parsed[1]!.id).toBe('d-2')
  })

  it('--from and --to together filter a range', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync([
        'node',
        'mindr',
        'replay',
        '--from',
        '2024-03-01',
        '--to',
        '2024-06-30',
        '--json',
      ]),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(2)
    expect(parsed[0]!.id).toBe('d-2')
    expect(parsed[1]!.id).toBe('d-3')
  })

  it('prints "No decisions found" when filter matches nothing', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--from', '2099-01-01', '--json']),
    )
    // Empty array since --json + empty
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(0)
  })

  it('table output shows numbered rows', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() => program.parseAsync(['node', 'mindr', 'replay']))
    expect(out).toContain('1')
    expect(out).toContain('use JWT')
  })
})

describe('mindr replay --show-reversed', () => {
  it('JSON output marks reversed decisions with reversed:true', async () => {
    const backend = new MockBackend([...SEED, makeReversedMarker('d-1')])
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--show-reversed', '--json']),
    )
    const parsed = JSON.parse(out) as Array<MindrMemory & { reversed: boolean }>
    expect(parsed.find((m) => m.id === 'd-1')?.reversed).toBe(true)
    expect(parsed.find((m) => m.id === 'd-2')?.reversed).toBe(false)
    expect(parsed.find((m) => m.id === 'd-3')?.reversed).toBe(false)
  })

  it('without --show-reversed all reversed fields are false', async () => {
    const backend = new MockBackend([...SEED, makeReversedMarker('d-1')])
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--json']),
    )
    const parsed = JSON.parse(out) as Array<MindrMemory & { reversed: boolean }>
    // Without --show-reversed, reversed markers are not queried → all false
    expect(parsed.every((m) => m.reversed === false)).toBe(true)
  })

  it('table output includes ANSI strikethrough for reversed decisions', async () => {
    const backend = new MockBackend([...SEED, makeReversedMarker('d-2')])
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })

    // Directly set chalk.level so styles apply in non-TTY test environments.
    const saved = chalk.level
    chalk.level = 3
    let out: string
    try {
      out = await captureStdout(() =>
        program.parseAsync(['node', 'mindr', 'replay', '--show-reversed']),
      )
    } finally {
      chalk.level = saved
    }
    // ANSI strikethrough \x1b[9m must appear for the reversed decision
    expect(out).toContain('\x1b[9m')
  })

  it('non-reversed decisions are not struck through even with --show-reversed', async () => {
    const backend = new MockBackend([...SEED, makeReversedMarker('d-1')])
    const program = new Command().exitOverride()
    addReplayCommands(program, { backend })

    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'replay', '--show-reversed', '--json']),
    )
    const parsed = JSON.parse(out) as Array<MindrMemory & { reversed: boolean }>
    expect(parsed.filter((m) => m.reversed === true)).toHaveLength(1)
    expect(parsed.filter((m) => m.reversed === true)[0]!.id).toBe('d-1')
  })
})
