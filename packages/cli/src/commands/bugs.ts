import type { Command } from 'commander'
import { getBackend, getRepoRoot, loadConfig } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'
import Table from 'cli-table3'

export interface BugsDeps { backend?: MemoryBackend }

async function backendFromDeps(deps: BugsDeps): Promise<MemoryBackend> {
  return deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))
}

export async function runBugsList(opts: { module?: string }, deps: BugsDeps): Promise<void> {
  const backend = await backendFromDeps(deps)
  let memories = await backend.listByTags([{ key: 'type', value: 'bug_pattern' }], 100)
  if (opts.module) memories = memories.filter((m) => m.tags.some((t) => t.key === 'module' && t.value === opts.module))
  const table = new Table({ head: ['ID', 'Module', 'Language', 'Fingerprint', 'Fix'] })
  for (const mem of memories) {
    table.push([
      mem.id.slice(0, 12),
      mem.tags.find((t) => t.key === 'module')?.value ?? '',
      mem.tags.find((t) => t.key === 'language')?.value ?? '',
      mem.tags.find((t) => t.key === 'fingerprint')?.value ?? '',
      mem.tags.find((t) => t.key === 'fix_commit')?.value?.slice(0, 12) ?? '',
    ])
  }
  process.stdout.write(memories.length ? `${table.toString()}\n` : 'No bug patterns found.\n')
}

export function addBugsCommands(program: Command, deps: BugsDeps = {}): void {
  const bugs = program.command('bugs').description('Manage bug pattern memories')
  bugs.command('list').option('--module <name>', 'Filter by module').action((opts: { module?: string }) => runBugsList(opts, deps))
}
