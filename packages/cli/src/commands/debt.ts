import type { Command } from 'commander'
import { debtTags, getBackend, getRepoRoot, loadConfig } from '@ai-emart/mindr-core'
import type { DebtSeverity, MemoryBackend } from '@ai-emart/mindr-core'
import Table from 'cli-table3'

export interface DebtDeps { backend?: MemoryBackend }

async function backendFromDeps(deps: DebtDeps): Promise<MemoryBackend> {
  return deps.backend ?? getBackend(loadConfig(await getRepoRoot(process.cwd())))
}

function ageDays(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000))
}

export async function runDebtList(opts: { severity?: string; module?: string; age?: string; json?: boolean }, deps: DebtDeps): Promise<void> {
  const backend = await backendFromDeps(deps)
  let memories = await backend.listByTags([{ key: 'type', value: 'debt' }], 500)
  if (opts.severity) memories = memories.filter((m) => m.tags.some((t) => t.key === 'severity' && t.value === opts.severity))
  if (opts.module) memories = memories.filter((m) => m.tags.some((t) => t.key === 'module' && t.value === opts.module))
  if (opts.age) memories = memories.filter((m) => ageDays(m.createdAt) >= Number.parseInt(opts.age ?? '0', 10))
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(memories, null, 2)}\n`)
    return
  }
  const table = new Table({ head: ['ID', 'Severity', 'Age', 'Location', 'Text'], colWidths: [14, 10, 8, 28, 60], wordWrap: true })
  for (const mem of memories) {
    table.push([
      mem.tags.find((t) => t.key === 'debt_id')?.value ?? mem.id.slice(0, 12),
      mem.tags.find((t) => t.key === 'severity')?.value ?? '',
      `${ageDays(mem.createdAt)}d`,
      mem.metadata?.['file'] ? `${mem.metadata['file']}:${mem.metadata['line']}` : '',
      mem.content,
    ])
  }
  process.stdout.write(memories.length ? `${table.toString()}\n` : 'No debt found.\n')
}

export async function runDebtAdd(text: string, opts: { file: string; severity?: DebtSeverity }, deps: DebtDeps): Promise<void> {
  const backend = await backendFromDeps(deps)
  const module = opts.file.includes('/') ? opts.file.split('/')[0] ?? 'root' : 'root'
  const memory = await backend.store({
    content: text,
    role: 'user',
    tags: [...debtTags({ module, severity: opts.severity ?? 'medium' }), { key: 'source', value: 'manual' }],
    metadata: { file: opts.file, severity: opts.severity ?? 'medium', manual: true },
  })
  process.stdout.write(`Added debt ${memory.id.slice(0, 12)}\n`)
}

export async function runDebtResolve(id: string, deps: DebtDeps): Promise<void> {
  const backend = await backendFromDeps(deps)
  await backend.store({
    content: `Manually resolved debt ${id}`,
    role: 'user',
    tags: [{ key: 'type', value: 'debt_resolved' }, { key: 'original_debt', value: id }, { key: 'source', value: 'manual' }],
    metadata: { originalId: id, resolvedAt: new Date().toISOString() },
  })
  process.stdout.write(`Resolved debt ${id}\n`)
}

export async function runDebtReport(deps: DebtDeps): Promise<void> {
  const backend = await backendFromDeps(deps)
  const memories = await backend.listByTags([{ key: 'type', value: 'debt' }], 1000)
  const buckets = new Map<string, number>()
  for (const mem of memories) {
    const module = mem.tags.find((t) => t.key === 'module')?.value ?? 'root'
    const severity = mem.tags.find((t) => t.key === 'severity')?.value ?? 'medium'
    const key = `${module}|${severity}`
    buckets.set(key, (buckets.get(key) ?? 0) + 1)
  }
  const lines = ['# Technical Debt Report', '', '| Module | Severity | Count |', '| --- | --- | --- |']
  for (const [key, count] of [...buckets.entries()].sort()) {
    const [module, severity] = key.split('|')
    lines.push(`| ${module} | ${severity} | ${count} |`)
  }
  process.stdout.write(`${lines.join('\n')}\n`)
}

export function addDebtCommands(program: Command, deps: DebtDeps = {}): void {
  const debt = program.command('debt').description('Manage technical debt memories')
  debt.command('list').option('--severity <severity>').option('--module <module>').option('--age <days>').option('--json').action((opts) => runDebtList(opts, deps))
  debt.command('add <text>').requiredOption('--file <path>').option('--severity <severity>').action((text: string, opts) => runDebtAdd(text, opts, deps))
  debt.command('resolve <id>').action((id: string) => runDebtResolve(id, deps))
  debt.command('report').action(() => runDebtReport(deps))
}
