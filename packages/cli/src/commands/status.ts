import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend, MEMORY_TYPES } from '@ai-emart/mindr-core'
import type { MemoryBackend, MindrConfig } from '@ai-emart/mindr-core'
import chalk from 'chalk'

const HOOK_MARKER = '# >>> mindr-begin <<<'

export interface StatusDeps {
  backend?: MemoryBackend
  repoRoot?: string
  config?: MindrConfig
}

function checkHookInstalled(repoRoot: string): boolean {
  const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit')
  if (!existsSync(hookPath)) return false
  return readFileSync(hookPath, 'utf8').includes(HOOK_MARKER)
}

export async function runStatus(deps: StatusDeps = {}): Promise<void> {
  const repoRoot =
    deps.repoRoot ?? (await getRepoRoot(process.cwd()).catch(() => null))
  const config = deps.config ?? (repoRoot ? loadConfig(repoRoot) : null)
  const backend = deps.backend ?? (config ? getBackend(config) : null)

  const hookInstalled = repoRoot ? checkHookInstalled(repoRoot) : false

  // Memory counts by type
  const counts: Record<string, number> = {}
  if (backend) {
    await Promise.all(
      MEMORY_TYPES.map(async (type) => {
        const mems = await backend.listByTags([{ key: 'type', value: type }])
        counts[type] = mems.length
      }),
    )
  }

  // Last commit: most recent context memory with a git_commit tag
  let lastCommit = 'none'
  if (backend) {
    const contextMems = await backend.listByTags([{ key: 'type', value: 'context' }])
    if (contextMems.length > 0) {
      const sorted = [...contextMems].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      const latest = sorted[0]!
      const commitTag = latest.tags.find((t) => t.key === 'git_commit')
      lastCommit = commitTag ? commitTag.value.slice(0, 8) : latest.createdAt.slice(0, 10)
    }
  }

  const backendType = config?.storage.backend ?? 'unknown'
  const hookLabel = hookInstalled ? chalk.green('installed') : chalk.yellow('not installed')
  const backendLabel = backendType === 'remembr' ? chalk.blue(backendType) : chalk.dim(backendType)

  process.stdout.write(
    [
      '',
      chalk.bold('Mindr Status'),
      '',
      `  ${chalk.cyan('Backend:')}     ${backendLabel}`,
      `  ${chalk.cyan('Git hook:')}    ${hookLabel}`,
      `  ${chalk.cyan('Last commit:')} ${chalk.dim(lastCommit)}`,
      '',
      chalk.bold('Memory counts'),
      ...MEMORY_TYPES.map((t) => `  ${chalk.cyan(t.padEnd(14))} ${counts[t] ?? 0}`),
      '',
    ].join('\n'),
  )
}

export function addStatusCommand(program: Command, deps: StatusDeps = {}): void {
  program
    .command('status')
    .description('Show Mindr status and memory counts')
    .action(async () => {
      await runStatus(deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
