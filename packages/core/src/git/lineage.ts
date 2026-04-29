import { simpleGit } from 'simple-git'

export interface BranchMemoryQuery {
  commits: string[]
  lineageFallback: string[]
}

/**
 * Returns SHAs reachable from `ref` via `git rev-list`, capped at `maxCommits`
 * (default 10 000) and `since` (default "1 year ago").
 */
export async function reachableCommits(
  repoRoot: string,
  ref: string,
  opts: { maxCommits?: number; since?: string } = {},
): Promise<string[]> {
  const git = simpleGit({ baseDir: repoRoot })
  const since = opts.since ?? '1 year ago'
  const maxCommits = opts.maxCommits ?? 10000
  const out = await git.raw(['rev-list', ref, `--since=${since}`, `--max-count=${maxCommits}`])
  return out
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
}

/**
 * Builds a query spec for finding all memories associated with `branch`:
 * - `commits`: SHAs reachable from `branch` (for exact SHA matching)
 * - `lineageFallback`: branch names whose `branch_lineage` tags serve as fallback
 *   when original SHAs are no longer reachable (squash-merge, cherry-pick, etc.)
 */
export async function branchMemoryQuery(
  repoRoot: string,
  branch: string,
): Promise<BranchMemoryQuery> {
  const commits = await reachableCommits(repoRoot, branch, {
    maxCommits: 10000,
    since: '1 year ago',
  })
  return { commits, lineageFallback: [branch] }
}
