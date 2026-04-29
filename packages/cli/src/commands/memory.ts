import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend, MEMORY_TYPES } from '@ai-emart/mindr-core'
import type { MemoryBackend, MindrMemory, MindrTag } from '@ai-emart/mindr-core'
import Table from 'cli-table3'
import chalk from 'chalk'

export interface MemoryListDeps {
  backend?: MemoryBackend
}

export interface MemoryListOpts {
  type?: string
  module?: string
  since?: string
  limit?: string
  json?: boolean
}

function tagValue(mem: MindrMemory, key: string): string {
  return mem.tags.find((t) => t.key === key)?.value ?? ''
}

export async function runMemoryList(opts: MemoryListOpts, deps: MemoryListDeps): Promise<void> {
  const backend =
    deps.backend ??
    getBackend(loadConfig(await getRepoRoot(process.cwd())))

  const tags: MindrTag[] = []
  if (opts.type) tags.push({ key: 'type', value: opts.type })
  if (opts.module) tags.push({ key: 'module', value: opts.module })

  const limit = opts.limit ? parseInt(opts.limit, 10) : 50
  let memories = await backend.listByTags(tags, limit)

  if (opts.since) {
    const since = new Date(opts.since)
    memories = memories.filter((m) => new Date(m.createdAt) >= since)
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify(memories, null, 2) + '\n')
    return
  }

  if (memories.length === 0) {
    process.stdout.write(chalk.dim('No memories found.\n'))
    return
  }

  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('Type'),
      chalk.cyan('Module'),
      chalk.cyan('Created'),
      chalk.cyan('Content'),
    ],
    colWidths: [14, 12, 10, 12, 46],
    wordWrap: true,
  })

  for (const mem of memories) {
    const content = mem.content.length > 55 ? mem.content.slice(0, 52) + '...' : mem.content
    table.push([
      mem.id.slice(0, 12),
      tagValue(mem, 'type'),
      tagValue(mem, 'module'),
      mem.createdAt.slice(0, 10),
      content,
    ])
  }

  process.stdout.write(table.toString() + '\n')
}

export function addMemoryCommands(program: Command, deps: MemoryListDeps = {}): void {
  const mem = program.command('memory').description('Manage memories')

  mem
    .command('list')
    .description('List stored memories')
    .option('--type <type>', `Filter by type (${MEMORY_TYPES.join('|')})`)
    .option('--module <module>', 'Filter by module')
    .option('--since <date>', 'Filter by date (ISO or YYYY-MM-DD)')
    .option('--limit <n>', 'Max results', '50')
    .option('--json', 'Output as JSON')
    .action(async (opts: MemoryListOpts) => {
      await runMemoryList(opts, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
