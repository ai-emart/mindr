import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend, onCommit } from '@ai-emart/mindr-core'

export function addInternalCommands(program: Command): void {
  const internal = program.command('internal')
  // Hidden from help — this command is called by the post-commit hook, not users.
  ;(internal as unknown as { hidden: boolean }).hidden = true

  internal
    .command('on-commit <sha>')
    .description('Process a git commit (invoked by the post-commit hook)')
    .action(async (sha: string) => {
      try {
        const repoRoot = await getRepoRoot(process.cwd())
        const config = loadConfig(repoRoot)
        const backend = getBackend(config)
        const result = await onCommit(repoRoot, sha, backend)
        if (process.env['MINDR_VERBOSE']) {
          process.stderr.write(
            `mindr: stored ${result.memoriesCreated} memories` +
              ` (${result.decisionMemories} decisions,` +
              ` ${result.debtMemories} debt,` +
              ` ${result.contextMemories} context)\n`,
          )
        }
      } catch (err) {
        // Swallow errors so the post-commit hook never fails the commit.
        if (process.env['MINDR_DEBUG']) {
          process.stderr.write(`mindr hook error: ${String(err)}\n`)
        }
      }
    })
}
