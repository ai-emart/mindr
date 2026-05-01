import type { Command } from 'commander'
import { getBackend, getRepoRoot, loadConfig } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'

export interface StatsDeps { backend?: MemoryBackend }

async function backendFromDeps(deps: StatsDeps): Promise<MemoryBackend> {
  return deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))
}

function cutoffFromLast(last?: string): Date | null {
  if (!last) return null
  const match = /^(\d+)(m|h|d|w)$/i.exec(last)
  if (!match) return null
  const amount = Number.parseInt(match[1]!, 10)
  const unit = match[2]!.toLowerCase()
  const millis =
    unit === 'm' ? amount * 60_000 :
    unit === 'h' ? amount * 3_600_000 :
    unit === 'd' ? amount * 86_400_000 :
    amount * 7 * 86_400_000
  return new Date(Date.now() - millis)
}

async function collectStats(backend: MemoryBackend, opts: { session?: string; last?: string }) {
  const cutoff = cutoffFromLast(opts.last)
  const memories = await backend.listByTags([{ key: 'type', value: 'metering' }], 1000)
  const sessions = new Set<string>()
  let tokensInjected = 0
  let estimatedSaved = 0
  for (const memory of memories) {
    const matchesSession = opts.session
      ? memory.sessionId === opts.session || memory.tags.some((tag) => tag.key === 'session' && tag.value === opts.session)
      : true
    if (!matchesSession) continue
    if (cutoff && new Date(memory.createdAt) < cutoff) continue
    if (memory.sessionId) sessions.add(memory.sessionId)
    const metadata = memory.metadata ?? {}
    tokensInjected += typeof metadata['tokensInjected'] === 'number' ? metadata['tokensInjected'] : 0
    estimatedSaved += typeof metadata['estimatedSaved'] === 'number' ? metadata['estimatedSaved'] : 0
  }
  return {
    sessions: opts.session ? 1 : sessions.size,
    tokensInjected,
    estimatedSaved,
    range: { low: Math.round(estimatedSaved * 0.5), high: estimatedSaved },
  }
}

export function addStatsCommand(program: Command, deps: StatsDeps = {}): void {
  program
    .command('stats')
    .option('--session <id>')
    .option('--last <window>')
    .description('Show token metering and estimated savings')
    .action(async (opts: { session?: string; last?: string }) => {
      const stats = await collectStats(await backendFromDeps(deps), opts)
      process.stdout.write([
        `Sessions: ${stats.sessions}`,
        `Tokens injected: ${stats.tokensInjected}`,
        `Saved ~${stats.estimatedSaved} tokens (range: ${stats.range.low}-${stats.range.high})`,
      ].join('\n') + '\n')
    })
}
