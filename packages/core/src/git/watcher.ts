import { simpleGit } from 'simple-git'
import {
  getCommitInfo,
  getDiffStat,
  getNewTopLevelDirs,
  type CommitFileChange,
} from './repo.js'
import {
  decisionTags,
  debtTags,
  contextTags,
  conventionTags,
} from '../schema.js'
import type { MemoryBackend } from '../storage/backend.js'
import { detect } from '../conventions/detector.js'
import { updateForChangedFiles } from '../conventions/incremental.js'
import type { ConventionProfile } from '../conventions/detector.js'

export interface CommitProcessingResult {
  memoriesCreated: number
  decisionMemories: number
  debtMemories: number
  contextMemories: number
  conventionMemories: number
}

const DECISION_KEYWORDS = /\b(refactor|switch|migrate|replace|chose|decided|architecture)\b/i

const DEPENDENCY_FILES = new Set([
  'package.json',
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'Cargo.toml',
  'Cargo.lock',
  'go.mod',
  'go.sum',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'poetry.lock',
  'Gemfile',
  'Gemfile.lock',
  'build.gradle',
])

const TODO_PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/

interface TodoFinding {
  file: string
  line: number
  keyword: string
  text: string
}

function isDependencyFileChange(files: CommitFileChange[]): boolean {
  return files.some((f) => DEPENDENCY_FILES.has(f.path.split('/').at(-1) ?? ''))
}

function getDecisionTrigger(
  message: string,
  totalChanges: number,
  uniqueDirs: number,
  newDirs: string[],
  depChange: boolean,
): string {
  if (DECISION_KEYWORDS.test(message)) return 'keyword'
  if (totalChanges > 100 && uniqueDirs >= 2) return 'large-cross-module-diff'
  if (newDirs.length > 0) return 'new-top-level-dir'
  if (depChange) return 'dependency-change'
  return 'unknown'
}

function extractTodos(diff: string): TodoFinding[] {
  const findings: TodoFinding[] = []
  let currentFile = ''
  let currentLine = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      currentFile = raw.slice(6)
      currentLine = 0
    } else if (raw.startsWith('@@ ')) {
      const m = raw.match(/\+(\d+)/)
      currentLine = m ? parseInt(m[1], 10) : 0
    } else if (raw.startsWith('+') && !raw.startsWith('+++')) {
      const text = raw.slice(1)
      const m = TODO_PATTERN.exec(text)
      if (m) {
        findings.push({ file: currentFile, line: currentLine, keyword: m[1], text: text.trim() })
      }
      currentLine++
    }
  }

  return findings
}

export async function onCommit(
  repoRoot: string,
  sha: string,
  backend: MemoryBackend,
): Promise<CommitProcessingResult> {
  const git = simpleGit({ baseDir: repoRoot })
  const [commitInfo, diffStat] = await Promise.all([
    getCommitInfo(git, sha),
    getDiffStat(git, sha),
  ])

  const newDirs = await getNewTopLevelDirs(git, sha, commitInfo.files)
  const totalChanges = diffStat.totalAdditions + diffStat.totalDeletions
  const depChange = isDependencyFileChange(commitInfo.files)

  const isDecision =
    DECISION_KEYWORDS.test(commitInfo.message) ||
    (totalChanges > 100 && diffStat.dirsTouched.length >= 2) ||
    newDirs.length > 0 ||
    depChange

  const result: CommitProcessingResult = {
    memoriesCreated: 0,
    decisionMemories: 0,
    debtMemories: 0,
    contextMemories: 0,
    conventionMemories: 0,
  }

  const primaryModule = diffStat.dirsTouched.find((d) => d !== '.') ?? 'root'

  if (isDecision) {
    const trigger = getDecisionTrigger(
      commitInfo.message,
      totalChanges,
      diffStat.dirsTouched.length,
      newDirs,
      depChange,
    )
    await backend.store({
      content: `Decision: ${commitInfo.message}`,
      role: 'system',
      tags: decisionTags({ module: primaryModule, commit: sha }),
      metadata: {
        sha,
        author: commitInfo.author,
        date: commitInfo.date,
        trigger,
        additions: diffStat.totalAdditions,
        deletions: diffStat.totalDeletions,
        filesChanged: diffStat.filesTouched,
        newDirs,
      },
    })
    result.decisionMemories++
    result.memoriesCreated++
  }

  // TODO/FIXME/HACK/XXX in added lines
  const diff = await git.raw(['show', '-U0', '--pretty=format:', sha])
  const todos = extractTodos(diff)

  for (const todo of todos) {
    const todoModule = todo.file.includes('/') ? todo.file.split('/')[0] : 'root'
    await backend.store({
      content: `${todo.keyword} at ${todo.file}:${todo.line} — ${todo.text}`,
      role: 'system',
      tags: debtTags({ module: todoModule }),
      metadata: { sha, file: todo.file, line: todo.line, keyword: todo.keyword },
    })
    result.debtMemories++
    result.memoriesCreated++
  }

  // Context memory — always emitted
  const dirSummary = diffStat.dirsTouched.join(', ') || 'root'
  await backend.store({
    content: `Commit ${sha.slice(0, 8)}: ${commitInfo.message}. Changed ${diffStat.filesTouched} file(s) (+${diffStat.totalAdditions}/-${diffStat.totalDeletions}) in: ${dirSummary}`,
    role: 'system',
    tags: [
      ...contextTags({ module: primaryModule }),
      { key: 'git_commit', value: sha },
    ],
    metadata: {
      sha,
      author: commitInfo.author,
      date: commitInfo.date,
      filesTouched: diffStat.filesTouched,
      additions: diffStat.totalAdditions,
      deletions: diffStat.totalDeletions,
    },
  })
  result.contextMemories++
  result.memoriesCreated++

  // Convention detection: full scan on first run, incremental on subsequent.
  try {
    const existing = await backend.listByTags([{ key: 'type', value: 'convention' }])
    const changedPaths = commitInfo.files.map((f) => f.path)

    let profiles: ConventionProfile[]
    if (existing.length === 0) {
      profiles = await detect(repoRoot)
    } else {
      const existingMap = new Map<string, ConventionProfile>()
      for (const mem of existing) {
        const lang = mem.tags.find((t) => t.key === 'language')?.value
        if (lang && mem.metadata?.profile) {
          existingMap.set(lang, mem.metadata.profile as ConventionProfile)
        }
      }
      const updated = await updateForChangedFiles(repoRoot, existingMap, changedPaths)
      profiles = Array.from(updated.values())
    }

    for (const profile of profiles) {
      if (profile.conventions.length === 0) continue

      // Check if scores changed >5% vs stored profile for this language
      const stored = existing.find(
        (m) => m.tags.some((t) => t.key === 'language' && t.value === profile.language),
      )
      if (stored?.metadata?.profile) {
        const prev = stored.metadata.profile as ConventionProfile
        const prevMap = new Map(prev.conventions.map((c) => [c.category, c.score]))
        const changed = profile.conventions.some((c) => {
          const prevScore = prevMap.get(c.category)
          return prevScore == null || Math.abs(c.score - prevScore) > 5
        })
        if (!changed) continue
      }

      const dominant = profile.conventions.find((c) => c.category === 'functionNames')
      const summary = profile.conventions
        .map((c) => `${c.category}: ${c.pattern} (${c.score}%, n=${c.sampleCount})`)
        .join('; ')

      await backend.store({
        content: `Convention profile for ${profile.language}: ${summary}`,
        role: 'system',
        tags: conventionTags({
          module: primaryModule,
          language: profile.language,
          pattern: dominant?.pattern,
          score: dominant?.score,
        }),
        metadata: { sha, language: profile.language, profile },
      })
      result.conventionMemories++
      result.memoriesCreated++
    }
  } catch {
    // Convention detection errors never fail a commit
  }

  return result
}
