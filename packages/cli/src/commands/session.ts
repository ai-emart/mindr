import type { Command } from 'commander'
import { checkpointSession, getBackend, getContextHealth, getRepoRoot, loadConfig } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'

export interface SessionDeps { backend?: MemoryBackend }

async function backendFromDeps(deps: SessionDeps): Promise<MemoryBackend> {
  return deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))
}

export function addSessionCommands(program: Command, deps: SessionDeps = {}): void {
  const session = program.command('session').description('Inspect session health and checkpoints')
  session.command('health <id>').action(async (id: string) => {
    const result = await getContextHealth(await backendFromDeps(deps), id)
    process.stdout.write(`${JSON.stringify({ score: result.score, recommendation: result.recommendation, breakdown: result.breakdown }, null, 2)}\n`)
  })
  session.command('checkpoint <id>').action(async (id: string) => {
    const memory = await checkpointSession(await backendFromDeps(deps), id)
    process.stdout.write(`Checkpoint ${memory.id.slice(0, 12)} stored for ${id}\n`)
  })
}
