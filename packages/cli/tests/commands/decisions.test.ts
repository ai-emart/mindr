import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import chalk from 'chalk'
import { addDecisionsCommands, runDecisionsReverse } from '../../src/commands/decisions.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'
import type { MindrMemory } from '@ai-emart/mindr-core'

function makeDecision(
  id: string,
  module: string,
  summary: string,
  createdAt = new Date().toISOString(),
  confidence?: number,
): MindrMemory {
  return {
    id,
    role: 'system',
    content: `Decision: ${summary}`,
    tags: [
      { key: 'type', value: 'decision' },
      { key: 'module', value: module },
    ],
    metadata: confidence != null ? { confidence, trigger: 'keyword', triggers: ['keyword'] } : null,
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
  makeDecision('d-1', 'auth', 'use JWT for sessions', '2024-01-01T00:00:00Z', 0.4),
  makeDecision('d-2', 'api', 'switch to tRPC', '2024-02-01T00:00:00Z', 0.65),
  makeDecision('d-3', 'auth', 'migrate to OAuth2', '2024-03-01T00:00:00Z'),
]

describe('mindr decisions (list)', () => {
  it('prints all decisions as a table', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() => program.parseAsync(['node', 'mindr', 'decisions']))
    expect(out).toContain('d-1')
    expect(out).toContain('use JWT for sessions')
    expect(out).toContain('switch to tRPC')
  })

  it('--json outputs a valid JSON array', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'decisions', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(Array.isArray(parsed)).toBe(true)
    expect(parsed.length).toBe(3)
  })

  it('--module filters by module tag', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'decisions', '--module', 'auth', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(2)
    expect(parsed.every((m) => m.tags.some((t) => t.key === 'module' && t.value === 'auth'))).toBe(
      true,
    )
  })

  it('--from filters decisions on or after date', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'decisions', '--from', '2024-02-01', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(2)
    expect(parsed.every((m) => new Date(m.createdAt) >= new Date('2024-02-01'))).toBe(true)
  })

  it('--to filters decisions on or before date', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'decisions', '--to', '2024-01-31', '--json']),
    )
    const parsed = JSON.parse(out) as MindrMemory[]
    expect(parsed).toHaveLength(1)
    expect(parsed[0]!.id).toBe('d-1')
  })

  it('shows confidence column when available', async () => {
    const backend = new MockBackend(SEED)
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() => program.parseAsync(['node', 'mindr', 'decisions']))
    // d-2 has confidence 0.65
    expect(out).toContain('0.65')
  })

  it('JSON output includes reversed:true for reversed decisions', async () => {
    const backend = new MockBackend([...SEED, makeReversedMarker('d-1')])
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'decisions', '--json']),
    )
    const parsed = JSON.parse(out) as Array<MindrMemory & { reversed: boolean }>
    const d1 = parsed.find((m) => m.id === 'd-1')
    expect(d1?.reversed).toBe(true)
    // Others are not reversed
    const d2 = parsed.find((m) => m.id === 'd-2')
    expect(d2?.reversed).toBe(false)
  })

  it('prints "No decisions found" when empty', async () => {
    const backend = new MockBackend([])
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() => program.parseAsync(['node', 'mindr', 'decisions']))
    expect(out).toContain('No decisions found')
  })
})

describe('mindr decisions reverse <id>', () => {
  it('stores a reversed marker for an existing decision', async () => {
    const backend = new MockBackend(SEED)
    await runDecisionsReverse('d-1', { backend })
    // Verify the marker was stored
    const markers = await backend.listByTags([{ key: 'reversed_decision', value: 'true' }])
    expect(markers).toHaveLength(1)
    expect(markers[0]!.tags.find((t) => t.key === 'original_decision')?.value).toBe('d-1')
  })

  it('prints a success message', async () => {
    const backend = new MockBackend(SEED)
    const out = await captureStdout(() => runDecisionsReverse('d-1', { backend }))
    expect(out).toContain('marked as reversed')
  })

  it('reversed decision appears with reversed:true in JSON list', async () => {
    const backend = new MockBackend(SEED)
    await runDecisionsReverse('d-2', { backend })

    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })
    const out = await captureStdout(() =>
      program.parseAsync(['node', 'mindr', 'decisions', '--json']),
    )
    const parsed = JSON.parse(out) as Array<MindrMemory & { reversed: boolean }>
    expect(parsed.find((m) => m.id === 'd-2')?.reversed).toBe(true)
    expect(parsed.find((m) => m.id === 'd-1')?.reversed).toBe(false)
  })

  it('table output includes strikethrough ANSI code for reversed decisions', async () => {
    const backend = new MockBackend([...SEED, makeReversedMarker('d-1')])
    const program = new Command().exitOverride()
    addDecisionsCommands(program, { backend })

    // Directly set chalk.level so styles apply in non-TTY test environments.
    const saved = chalk.level
    chalk.level = 3
    let out: string
    try {
      out = await captureStdout(() => program.parseAsync(['node', 'mindr', 'decisions']))
    } finally {
      chalk.level = saved
    }
    // ANSI strikethrough is ESC[9m
    expect(out).toContain('\x1b[9m')
  })
})
