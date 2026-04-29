import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'
import chalk from 'chalk'

export interface ForgetDeps {
  backend?: MemoryBackend
}

export async function runForget(id: string, deps: ForgetDeps): Promise<void> {
  const backend =
    deps.backend ??
    getBackend(loadConfig(await getRepoRoot(process.cwd())))

  await backend.forget(id)
  process.stdout.write(`${chalk.green('✓')} Forgot memory ${chalk.dim(id)}\n`)
}

export function addForgetCommand(program: Command, deps: ForgetDeps = {}): void {
  program
    .command('forget <id>')
    .description('Soft-delete a memory by ID')
    .action(async (id: string) => {
      await runForget(id, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
