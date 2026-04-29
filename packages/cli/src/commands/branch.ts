import type { Command } from 'commander'
import { simpleGit } from 'simple-git'
import { reachableCommits, getRepoRoot, loadConfig, getBackend } from '@ai-emart/mindr-core'
import type { MemoryBackend } from '@ai-emart/mindr-core'

export interface BranchDeps {
  backend?: MemoryBackend
  cwd?: string
}

export async function runBranchStatus(deps: BranchDeps): Promise<void> {
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

  const lastActivity =
    branchMems.length > 0
      ? branchMems
          .slice()
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]!.createdAt
          .slice(0, 16)
          .replace('T', ' ')
      : null

  console.log(`BRANCH: ${currentBranch}`)
  console.log(`  Memories on this branch:      ${branchMems.length}`)
  console.log(`  Reachable memories            `)
  console.log(`    (${commits.length} commit${commits.length === 1 ? '' : 's'}, last 90d): ${reachableMems.length}`)
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
    .action(async () => {
      await runBranchStatus(deps)
    })
}
