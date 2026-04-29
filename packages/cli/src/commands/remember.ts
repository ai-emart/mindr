import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend, MEMORY_TYPES } from '@ai-emart/mindr-core'
import type { MemoryBackend, MindrTag } from '@ai-emart/mindr-core'
import chalk from 'chalk'

export interface RememberDeps {
  backend?: MemoryBackend
}

function parseTags(raw: string[]): MindrTag[] {
  return raw.flatMap((s) => {
    const idx = s.indexOf(':')
    if (idx === -1) return []
    return [{ key: s.slice(0, idx), value: s.slice(idx + 1) }]
  })
}

export async function runRemember(
  content: string,
  opts: { type?: string; module?: string; tag?: string[] },
  deps: RememberDeps,
): Promise<void> {
  const tags: MindrTag[] = []
  if (opts.type) tags.push({ key: 'type', value: opts.type })
  if (opts.module) tags.push({ key: 'module', value: opts.module })
  tags.push(...parseTags(opts.tag ?? []))

  const backend =
    deps.backend ??
    getBackend(loadConfig(await getRepoRoot(process.cwd())))

  const mem = await backend.store({ content, role: 'user', tags })
  process.stdout.write(`${chalk.green('✓')} Stored memory ${chalk.dim(mem.id)}\n`)
}

export function addRememberCommand(program: Command, deps: RememberDeps = {}): void {
  program
    .command('remember <content>')
    .description('Store a manual memory')
    .option('--type <type>', `Memory type (${MEMORY_TYPES.join('|')})`)
    .option('--module <module>', 'Module or area this memory belongs to')
    .option(
      '--tag <k:v>',
      'Extra tag key:value (repeatable)',
      (v: string, prev: string[]) => [...prev, v],
      [] as string[],
    )
    .action(async (content: string, opts: { type?: string; module?: string; tag?: string[] }) => {
      await runRemember(content, opts, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
