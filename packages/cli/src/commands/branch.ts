import type { Command } from 'commander'
import { simpleGit } from 'simple-git'
import { reachableCommits, getRepoRoot, loadConfig, getBackend } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'

export interface BranchDeps {
  backend?: MemoryBackend
  cwd?: string
}

export async function runBranchStatus(deps: BranchDeps, opts: { json?: boolean } = {}): Promise<void> {
  const cwd = deps.cwd ?? process.cwd()
  const backend =
    deps.backend ?? getBackend(loadConfig(await getRepoRoot(cwd)))

  const git = simpleGit({ baseDir: cwd })

  let currentBranch: string
  try {
    currentBranch = (await git.revparse(['--abbrev-ref', 'HEAD'])).trim()
  } catch {
    console.log('Not a git repository.')
    return
  }

  // Determine default branch (main or master)
  let defaultBranch = 'main'
  try {
    const remoteHead = (await git.raw(['symbolic-ref', 'refs/remotes/origin/HEAD'])).trim()
    const parts = remoteHead.split('/')
    defaultBranch = parts[parts.length - 1] ?? 'main'
  } catch {
    // fallback: check if 'master' exists
    try {
      await git.raw(['rev-parse', '--verify', 'master'])
      defaultBranch = 'master'
    } catch { /* keep 'main' */ }
  }

  // Memories written while on the current branch (by lineage tag).
  const branchMems = await backend.listByTags([
    { key: 'branch_lineage', value: currentBranch },
  ])

  // Memories reachable by commit SHA from current branch (up to 1 000 commits, 90 days).
  const commits = await reachableCommits(cwd, currentBranch, {
    maxCommits: 1000,
    since: '90 days ago',
  })
  const reachableMems = await backend.searchByCommitSet(commits, [currentBranch])

  // Memories from the default branch (shared baseline)
  let mainMems: Awaited<ReturnType<typeof backend.listByTags>> = []
  if (currentBranch !== defaultBranch) {
    mainMems = await backend.listByTags([
      { key: 'branch_lineage', value: defaultBranch },
    ])
  }

  // Shared = memories reachable from current branch AND tagged to default branch
  const reachableIds = new Set(reachableMems.map((m) => m.id))
  const sharedCount = mainMems.filter((m) => reachableIds.has(m.id)).length

  const lastActivity =
    branchMems.length > 0
      ? branchMems
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!.createdAt
          .slice(0, 16)
          .replace('T', ' ')
      : null

  if (opts.json) {
    process.stdout.write(`${JSON.stringify({
      currentBranch,
      defaultBranch,
      branchMemoryCount: branchMems.length,
      reachableMemoryCount: reachableMems.length,
      defaultBranchMemoryCount: mainMems.length,
      sharedCount,
      lastActivity,
    }, null, 2)}\n`)
    return
  }

  console.log(`BRANCH: ${currentBranch}`)
  console.log(`  Memories on this branch:      ${branchMems.length}`)
  console.log(`  Reachable memories            `)
  console.log(`    (${commits.length} commit${commits.length === 1 ? '' : 's'}, last 90d): ${reachableMems.length}`)
  if (currentBranch !== defaultBranch) {
    console.log(`  Shared from ${defaultBranch}:            ${sharedCount}`)
    console.log(`  Memories on ${defaultBranch}:              ${mainMems.length}`)
  }
  if (lastActivity) {
    console.log(`  Last activity:                ${lastActivity}`)
  }
}

export function addBranchCommands(
  program: Command,
  deps: BranchDeps = {},
): void {
  const branch = program
    .command('branch')
    .description('Branch-scoped memory commands')

  branch
    .command('status')
    .description('Show memory activity for the current git branch')
    .option('--json', 'Output as JSON')
    .action(async (opts: { json?: boolean }) => {
      await runBranchStatus(deps, opts)
    })
}
