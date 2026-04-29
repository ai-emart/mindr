import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend } from '@ai-emart/mindr-core'
import type { MemoryBackend, MindrMemory, MindrTag } from '@ai-emart/mindr-core'
import Table from 'cli-table3'
import chalk from 'chalk'

export interface DecisionsDeps {
  backend?: MemoryBackend
}

export interface DecisionsListOpts {
  module?: string
  from?: string
  to?: string
  limit?: string
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

export async function runDecisionsList(
  opts: DecisionsListOpts,
  deps: DecisionsDeps,
): Promise<void> {
  const backend =
    deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))

  let memories = await backend.listByTags(
    [{ key: 'type', value: 'decision' }],
    opts.limit ? parseInt(opts.limit, 10) : 50,
  )

  if (opts.module) {
    memories = memories.filter((m) =>
      m.tags.some((t) => t.key === 'module' && t.value === opts.module),
    )
  }
  if (opts.from) {
    const from = new Date(opts.from)
    memories = memories.filter((m) => new Date(m.createdAt) >= from)
  }
  if (opts.to) {
    const to = new Date(opts.to)
    memories = memories.filter((m) => new Date(m.createdAt) <= to)
  }

  const reversedIds = await getReversedIds(backend)

  if (opts.json) {
    const out = memories.map((m) => ({ ...m, reversed: reversedIds.has(m.id) }))
    process.stdout.write(JSON.stringify(out, null, 2) + '\n')
    return
  }

  if (memories.length === 0) {
    process.stdout.write(chalk.dim('No decisions found.\n'))
    return
  }

  const table = new Table({
    head: [
      chalk.cyan('ID'),
      chalk.cyan('Module'),
      chalk.cyan('Conf'),
      chalk.cyan('Triggers'),
      chalk.cyan('Date'),
      chalk.cyan('Summary'),
    ],
    colWidths: [14, 10, 6, 22, 12, 39],
    wordWrap: true,
  })

  for (const mem of memories) {
    const meta = (mem.metadata ?? {}) as Record<string, unknown>
    const summary = mem.content.startsWith('Decision: ')
      ? mem.content.slice('Decision: '.length)
      : mem.content
    const truncated = summary.length > 44 ? summary.slice(0, 41) + '...' : summary
    const isReversed = reversedIds.has(mem.id)
    const confidence =
      typeof meta['confidence'] === 'number' ? (meta['confidence'] as number).toFixed(2) : ''
    const triggerStr = Array.isArray(meta['triggers'])
      ? (meta['triggers'] as string[]).join(', ')
      : typeof meta['trigger'] === 'string'
        ? (meta['trigger'] as string)
        : ''
    const triggerTrunc = triggerStr.length > 20 ? triggerStr.slice(0, 19) + '…' : triggerStr

    table.push([
      mem.id.slice(0, 12),
      tagValue(mem, 'module'),
      confidence,
      triggerTrunc,
      mem.createdAt.slice(0, 10),
      isReversed ? chalk.strikethrough(chalk.dim(truncated)) : truncated,
    ])
  }

  process.stdout.write(table.toString() + '\n')
}

export async function runDecisionsReverse(id: string, deps: DecisionsDeps): Promise<void> {
  const backend =
    deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))

  const decision = await backend.getById(id)
  if (!decision) {
    process.stderr.write(chalk.red(`✗ Decision not found: ${id}\n`))
    process.exit(1)
  }
  if (!decision.tags.some((t) => t.key === 'type' && t.value === 'decision')) {
    process.stderr.write(chalk.red(`✗ Memory ${id} is not a decision\n`))
    process.exit(1)
  }

  await backend.store({
    content: `Reversed decision ${id}`,
    role: 'system',
    tags: [
      { key: 'type', value: 'note' },
      { key: 'reversed_decision', value: 'true' },
      { key: 'original_decision', value: id },
    ],
    metadata: { reversedAt: new Date().toISOString() },
  })

  process.stdout.write(chalk.green(`✓ Decision ${id.slice(0, 12)} marked as reversed\n`))
}

export function addDecisionsCommands(program: Command, deps: DecisionsDeps = {}): void {
  const dec = program
    .command('decisions')
    .description('List and manage decision memories')
    .option('--module <module>', 'Filter by module')
    .option('--from <date>', 'Show decisions on or after date (ISO or YYYY-MM-DD)')
    .option('--to <date>', 'Show decisions on or before date (ISO or YYYY-MM-DD)')
    .option('--limit <n>', 'Max results', '50')
    .option('--json', 'Output as JSON')
    .action(async (opts: DecisionsListOpts) => {
      await runDecisionsList(opts, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })

  dec
    .command('reverse <id>')
    .description('Mark a decision as reversed (contradicted by a later decision)')
    .action(async (id: string) => {
      await runDecisionsReverse(id, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
