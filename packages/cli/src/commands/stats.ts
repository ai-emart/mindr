import type { Command } from 'commander'
import { getBackend, getRepoRoot, getStats, loadConfig } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'

export interface StatsDeps { backend?: MemoryBackend }

async function backendFromDeps(deps: StatsDeps): Promise<MemoryBackend> {
  return deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))
}

export function addStatsCommand(program: Command, deps: StatsDeps = {}): void {
  program
    .command('stats')
    .option('--session <id>')
    .option('--last <window>')
    .description('Show token metering and estimated savings')
    .action(async (opts: { session?: string }) => {
      const stats = await getStats(await backendFromDeps(deps), opts.session)
      process.stdout.write([
        `Sessions: ${stats.sessions}`,
        `Tokens injected: ${stats.tokensInjected}`,
        `Saved ~${stats.estimatedSaved} tokens (range: ${stats.range.low}-${stats.range.high})`,
      ].join('\n') + '\n')
    })
}
