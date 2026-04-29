import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend } from '@ai-emart/mindr-core'
import type { MemoryBackend, MindrMemory } from '@ai-emart/mindr-core'
import Table from 'cli-table3'
import chalk from 'chalk'

export interface ReplayDeps {
  backend?: MemoryBackend
}

export interface ReplayOpts {
  module?: string
  from?: string
  to?: string
  showReversed?: boolean
  json?: boolean
}

function tagValue(mem: MindrMemory, key: string): string {
  return mem.tags.find((t) => t.key === key)?.value ?? ''
}

async function getReversedIds(backend: MemoryBackend): Promise<Set<string>> {
  const markers = await backend.listByTags([{ key: 'reversed_decision', value: 'true' }])
  const ids = new Set<string>()
  for (const m of markers) {
    const origId = m.tags.find((t) => t.key === 'original_decision')?.value
    if (origId) ids.add(origId)
  }
  return ids
}

export async function runReplay(opts: ReplayOpts, deps: ReplayDeps): Promise<void> {
  const backend =
    deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))

  let decisions = await backend.listByTags([{ key: 'type', value: 'decision' }], 200)

  if (opts.module) {
    decisions = decisions.filter((m) =>
      m.tags.some((t) => t.key === 'module' && t.value === opts.module),
    )
  }
  if (opts.from) {
    const from = new Date(opts.from)
    decisions = decisions.filter((m) => new Date(m.createdAt) >= from)
  }
  if (opts.to) {
    const to = new Date(opts.to)
    decisions = decisions.filter((m) => new Date(m.createdAt) <= to)
  }

  // Chronological order — oldest first.
  decisions.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())

  const reversedIds = opts.showReversed ? await getReversedIds(backend) : new Set<string>()

  if (opts.json) {
    const out = decisions.map((m) => ({ ...m, reversed: reversedIds.has(m.id) }))
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    return
  }

  if (decisions.length === 0) {
    process.stdout.write(chalk.dim('No decisions found.\n'))
    return
  }

  const table = new Table({
    head: [chalk.cyan('#'), chalk.cyan('Date'), chalk.cyan('Module'), chalk.cyan('Summary')],
    colWidths: [5, 12, 12, 62],
    wordWrap: true,
  })

  decisions.forEach((mem, i) => {
    const summary = mem.content.startsWith('Decision: ')
      ? mem.content.slice('Decision: '.length)
      : mem.content
    const truncated = summary.length > 68 ? summary.slice(0, 65) + '...' : summary
    const isReversed = reversedIds.has(mem.id)

    table.push([
      String(i + 1),
      mem.createdAt.slice(0, 10),
      tagValue(mem, 'module'),
      isReversed ? chalk.strikethrough(chalk.dim(truncated)) : truncated,
    ])
  })

  process.stdout.write(table.toString() + '\n')
}

export function addReplayCommands(program: Command, deps: ReplayDeps = {}): void {
  program
    .command('replay')
    .description('Show decisions in chronological order')
    .option('--module <name>', 'Filter by module')
    .option('--from <date>', 'Show decisions on or after date (ISO or YYYY-MM-DD)')
    .option('--to <date>', 'Show decisions on or before date (ISO or YYYY-MM-DD)')
    .option('--show-reversed', 'Mark decisions that were later reversed with strikethrough')
    .option('--json', 'Output as JSON')
    .action(async (opts: ReplayOpts) => {
      await runReplay(opts, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
