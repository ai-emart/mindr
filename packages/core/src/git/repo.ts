import { simpleGit, type SimpleGit } from 'simple-git'

export { type SimpleGit }

export class NotARepoError extends Error {
  constructor(cwd: string) {
    super(`Not a git repository: ${cwd}`)
    this.name = 'NotARepoError'
  }
}

export interface CommitFileChange {
  path: string
  additions: number
  deletions: number
  // 'A' additions-only, 'D' deletions-only, 'M' modified, '?' binary/unknown
  status: 'A' | 'D' | 'M' | '?'
}

export interface CommitInfo {
  sha: string
  message: string
  author: string
  date: string
  files: CommitFileChange[]
}

export interface DiffStat {
  totalAdditions: number
  totalDeletions: number
  filesTouched: number
  dirsTouched: string[]
}

export function makeGit(repoRoot: string): SimpleGit {
  return simpleGit({ baseDir: repoRoot })
}

export async function getRepoRoot(cwd: string): Promise<string> {
  const git = simpleGit({ baseDir: cwd })
  try {
    const root = await git.revparse(['--show-toplevel'])
    return root.trim()
  } catch {
    throw new NotARepoError(cwd)
  }
}

export async function getCurrentBranch(git: SimpleGit): Promise<string> {
  const branch = await git.revparse(['--abbrev-ref', 'HEAD'])
  return branch.trim()
}

export async function getHeadCommit(git: SimpleGit): Promise<string> {
  const sha = await git.revparse(['HEAD'])
  return sha.trim()
}

export async function getCommitsReachable(
  git: SimpleGit,
  ref: string,
  limit: number,
): Promise<string[]> {
  const result = await git.raw(['log', '--format=%H', '-n', String(limit), ref])
  return result
    .trim()
    .split('\n')
    .filter(Boolean)
}

function parseNumstat(output: string): CommitFileChange[] {
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('\t')
      if (parts.length < 3) return null
      const additions = parts[0] === '-' ? 0 : parseInt(parts[0], 10)
      const deletions = parts[1] === '-' ? 0 : parseInt(parts[1], 10)
      const path = parts[2].trim()
      let status: CommitFileChange['status'] = 'M'
      if (additions > 0 && deletions === 0) status = 'A'
      else if (additions === 0 && deletions > 0) status = 'D'
      else if (parts[0] === '-' && parts[1] === '-') status = '?'
      return { path, additions, deletions, status }
    })
    .filter((f): f is CommitFileChange => f !== null && f.path.length > 0)
}

export async function getCommitInfo(git: SimpleGit, sha: string): Promise<CommitInfo> {
  // %x00 as delimiter is safe since commit messages can contain newlines
  const meta = await git.raw([
    'log',
    '-n',
    '1',
    '--format=%H%x00%B%x00%an%x00%ai',
    sha,
  ])
  const parts = meta.trim().split('\x00')

  const numstat = await git.raw(['show', '--numstat', '--pretty=format:', sha])

  return {
    sha: parts[0]?.trim() ?? sha,
    message: parts[1]?.trim() ?? '',
    author: parts[2]?.trim() ?? '',
    date: parts[3]?.trim() ?? '',
    files: parseNumstat(numstat),
  }
}

export async function getDiffStat(git: SimpleGit, sha: string): Promise<DiffStat> {
  const numstat = await git.raw(['show', '--numstat', '--pretty=format:', sha])
  const files = parseNumstat(numstat)

  const totalAdditions = files.reduce((s, f) => s + f.additions, 0)
  const totalDeletions = files.reduce((s, f) => s + f.deletions, 0)

  const dirSet = new Set<string>()
  for (const f of files) {
    const slash = f.path.indexOf('/')
    dirSet.add(slash === -1 ? '.' : f.path.slice(0, slash))
  }

  return {
    totalAdditions,
    totalDeletions,
    filesTouched: files.length,
    dirsTouched: [...dirSet],
  }
}

// Returns top-level directories that are new in this commit (didn't exist before).
// Returns [] for the initial commit — there is no prior state to compare against.
export async function getNewTopLevelDirs(
  git: SimpleGit,
  sha: string,
  files: CommitFileChange[],
): Promise<string[]> {
  // Verify the commit has a parent; if not (initial commit), skip the check.
  try {
    await git.revparse([`${sha}^`])
  } catch {
    return []
  }

  const raw = await git.raw(['ls-tree', '--name-only', `${sha}^`])
  const beforeNames = new Set(raw.trim().split('\n').filter(Boolean))

  const addedTopDirs = new Set<string>()
  for (const f of files) {
    const slash = f.path.indexOf('/')
    if (slash !== -1) addedTopDirs.add(f.path.slice(0, slash))
  }

  return [...addedTopDirs].filter((d) => !beforeNames.has(d))
}
