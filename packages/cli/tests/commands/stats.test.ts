import { describe, expect, it } from 'vitest'
import { Command } from 'commander'
import { addStatsCommand } from '../../src/commands/stats.js'
import { MockBackend, captureStdout } from '../helpers/mock-backend.js'
import type { MindrMemory } from '@ai-emart/mindr-core'

function metering(id: string, createdAt: string, tokensInjected: number): MindrMemory {
  return {
    id,
    role: 'system',
    content: `metering ${id}`,
    tags: [{ key: 'type', value: 'metering' }, { key: 'session', value: 's1' }],
    metadata: { tokensInjected, estimatedSaved: tokensInjected * 2 },
    sessionId: 's1',
    createdAt,
  }
}

describe('mindr stats', () => {
  it('--last filters metering memories by age', async () => {
    const program = new Command()
    program.exitOverride()
    addStatsCommand(program, {
      backend: new MockBackend([
        metering('recent', new Date().toISOString(), 10),
        metering('old', new Date(Date.now() - 10 * 86_400_000).toISOString(), 100),
      ]),
    })

    const output = await captureStdout(async () => {
      await program.parseAsync(['node', 'mindr', 'stats', '--last', '1d'])
    })

    expect(output).toContain('Tokens injected: 10')
    expect(output).toContain('range: 10-20')
  })
})
