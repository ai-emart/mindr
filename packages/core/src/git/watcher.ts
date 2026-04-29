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
  bugTags,
} from '../schema.js'
import type { MemoryBackend } from '../storage/backend.js'
import { detect } from '../conventions/detector.js'
import { updateForChangedFiles } from '../conventions/incremental.js'
import type { ConventionProfile } from '../conventions/detector.js'
import { detectDebtInUnifiedDiff } from '../debt/detector.js'
import { functionFingerprints } from '../bugs/fingerprint.js'

export interface CommitProcessingResult {
  memoriesCreated: number
  decisionMemories: number
  debtMemories: number
  contextMemories: number
  conventionMemories: number
  bugPatternMemories: number
}

export type DecisionTrigger =
  | 'keyword'
  | 'large-cross-module-diff'
  | 'new-top-level-dir'
  | 'dependency-change'
  | 'import-pattern-change'

const TRIGGER_WEIGHTS: Record<DecisionTrigger, number> = {
  keyword: 0.4,
  'large-cross-module-diff': 0.25,
  'new-top-level-dir': 0.3,
  'dependency-change': 0.15,
  'import-pattern-change': 0.25,
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

const BUG_FIX_MESSAGE = /\b(fix|bug|hotfix|patch)\b/i

function isDependencyFileChange(files: CommitFileChange[]): boolean {
  return files.some((f) => DEPENDENCY_FILES.has(f.path.split('/').at(-1) ?? ''))
}

/** Detect whether 5+ distinct files have added or changed import/require lines. */
function detectImportPatternChange(diff: string): boolean {
  const filesWithImportChanges = new Set<string>()
  let currentFile = ''
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      currentFile = line.slice(6)
    } else if (line.startsWith('+') && !line.startsWith('+++') && currentFile) {
      const text = line.slice(1)
      if (/^\s*(import\s|from\s+['"]|require\()/.test(text)) {
        filesWithImportChanges.add(currentFile)
      }
    }
  }
  return filesWithImportChanges.size >= 5
}

/**
 * Extract package version changes from a dep-file diff.
 * Returns only pairs where both from and to versions are present and differ.
 */
function extractVersionDiffs(diff: string): Record<string, { from: string; to: string }> {
  const changes: Record<string, { from: string; to: string }> = {}
  let inDepFile = false
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ b/')) {
      const fname = line.slice(6).split('/').at(-1) ?? ''
      inDepFile = DEPENDENCY_FILES.has(fname)
    }
    if (!inDepFile) continue
    const rm = line.match(/^-\s*"([^"]+)":\s*"([^"]+)"/)
    const add = line.match(/^\+\s*"([^"]+)":\s*"([^"]+)"/)
    if (rm?.[1] && rm[2] && /^[\^~]?\d/.test(rm[2])) {
      if (!changes[rm[1]]) changes[rm[1]] = { from: '', to: '' }
      changes[rm[1]]!.from = rm[2]
    }
    if (add?.[1] && add[2] && /^[\^~]?\d/.test(add[2])) {
      if (!changes[add[1]]) changes[add[1]] = { from: '', to: '' }
      changes[add[1]]!.to = add[2]
    }
  }
  return Object.fromEntries(
    Object.entries(changes).filter(([, v]) => v.from && v.to && v.from !== v.to),
  )
}

/** Compute a 0–1 confidence score by summing per-trigger weights. */
export function computeConfidence(triggers: DecisionTrigger[]): number {
  const raw = triggers.reduce((sum, t) => sum + TRIGGER_WEIGHTS[t], 0)
  return Math.min(1, Math.round(raw * 100) / 100)
}

/** Pull the commit body (everything after the first line) into a rationale string. */
export function extractRationale(message: string): string | null {
  const lines = message.split('\n')
  let i = 1
  while (i < lines.length && (lines[i]?.trim() ?? '') === '') i++
  if (i >= lines.length) return null
  const body = lines.slice(i).join('\n').trim()
  return body.length > 0 ? body : null
}

function getDecisionTriggers(
  message: string,
  totalChanges: number,
  uniqueDirs: number,
  newDirs: string[],
  depChange: boolean,
  importPatternChange: boolean,
): DecisionTrigger[] {
  const triggers: DecisionTrigger[] = []
  if (DECISION_KEYWORDS.test(message)) triggers.push('keyword')
  if (totalChanges > 100 && uniqueDirs >= 2) triggers.push('large-cross-module-diff')
  if (newDirs.length > 0) triggers.push('new-top-level-dir')
  if (depChange) triggers.push('dependency-change')
  if (importPatternChange) triggers.push('import-pattern-change')
  return triggers
}

function languageForPath(path: string): string | null {
  if (/\.(ts|tsx)$/.test(path)) return 'typescript'
  if (/\.(js|jsx)$/.test(path)) return 'javascript'
  if (/\.py$/.test(path)) return 'python'
  return null
}

function moduleForPath(path: string): string {
  return path.includes('/') ? path.split('/')[0] ?? 'root' : 'root'
}

async function showFileAt(git: ReturnType<typeof simpleGit>, ref: string, path: string): Promise<string | null> {
  try {
    return await git.raw(['show', `${ref}:${path}`])
  } catch {
    return null
  }
}

export async function onCommit(
  repoRoot: string,
  sha: string,
  backend: MemoryBackend,
): Promise<CommitProcessingResult> {
  const git = simpleGit({ baseDir: repoRoot })
  const [commitInfo, diffStat, branchRaw] = await Promise.all([
    getCommitInfo(git, sha),
    getDiffStat(git, sha),
    git.revparse(['--abbrev-ref', 'HEAD']).catch(() => 'unknown'),
  ])
  const branch = branchRaw.trim()

  // Tags added to every memory written for this commit.
  const lineageTags: Array<{ key: string; value: string }> = [
    { key: 'git_commit', value: sha },
    { key: 'branch_lineage', value: branch },
  ]

  // Fetch unified diff once — used for TODO extraction, import detection, version diffs.
  const diff = await git.raw(['show', '-U0', '--pretty=format:', sha])

  const newDirs = await getNewTopLevelDirs(git, sha, commitInfo.files)
  const totalChanges = diffStat.totalAdditions + diffStat.totalDeletions
  const depChange = isDependencyFileChange(commitInfo.files)
  const importPatternChange = detectImportPatternChange(diff)

  // Subject line only — body goes to rationale.
  const subject = commitInfo.message.split('\n')[0] ?? commitInfo.message

  const triggers = getDecisionTriggers(
    subject,
    totalChanges,
    diffStat.dirsTouched.length,
    newDirs,
    depChange,
    importPatternChange,
  )

  const result: CommitProcessingResult = {
    memoriesCreated: 0,
    decisionMemories: 0,
    debtMemories: 0,
    contextMemories: 0,
    conventionMemories: 0,
    bugPatternMemories: 0,
  }

  const primaryModule = diffStat.dirsTouched.find((d) => d !== '.') ?? 'root'

  if (triggers.length > 0) {
    const confidence = computeConfidence(triggers)
    const rationale = extractRationale(commitInfo.message)
    const filesAffected = commitInfo.files.map((f) => f.path)
    const versionDiffs = depChange ? extractVersionDiffs(diff) : undefined

    await backend.store({
      content: `Decision: ${subject}`,
      role: 'system',
      tags: [...decisionTags({ module: primaryModule, commit: sha, confidence: String(confidence) }), ...lineageTags],
      metadata: {
        sha,
        author: commitInfo.author,
        date: commitInfo.date,
        // Primary trigger kept for backward compatibility; triggers array is the full set.
        trigger: triggers[0],
        triggers,
        confidence,
        rationale,
        filesAffected,
        additions: diffStat.totalAdditions,
        deletions: diffStat.totalDeletions,
        filesChanged: diffStat.filesTouched,
        newDirs,
        ...(versionDiffs && Object.keys(versionDiffs).length > 0 ? { versionDiffs } : {}),
      },
    })
    result.decisionMemories++
    result.memoriesCreated++
  }

  const debtFindings = detectDebtInUnifiedDiff(diff)

  for (const debt of debtFindings) {
    const debtModule = moduleForPath(debt.file)
    if (debt.removed) {
      await backend.store({
        content: `Resolved debt ${debt.id} at ${debt.file}:${debt.line}`,
        role: 'system',
        tags: [
          { key: 'type', value: 'debt_resolved' },
          { key: 'module', value: debtModule },
          { key: 'original_debt', value: debt.id },
          ...lineageTags,
        ],
        metadata: { sha, file: debt.file, line: debt.line, marker: debt.marker, resolutionCommit: sha },
      })
      result.debtMemories++
      result.memoriesCreated++
      continue
    }
    await backend.store({
      content: `${debt.marker} at ${debt.file}:${debt.line} — ${debt.text}`,
      role: 'system',
      tags: [...debtTags({ module: debtModule, severity: debt.severity, debtId: debt.id }), ...lineageTags],
      metadata: {
        id: debt.id,
        sha,
        author: commitInfo.author,
        dateIntroduced: commitInfo.date,
        file: debt.file,
        line: debt.line,
        keyword: debt.marker,
        marker: debt.marker,
        severity: debt.severity,
      },
    })
    result.debtMemories++
    result.memoriesCreated++
  }

  if (BUG_FIX_MESSAGE.test(subject) && commitInfo.files.some((file) => file.status !== 'A' && file.deletions > 0)) {
    for (const file of commitInfo.files) {
      const language = languageForPath(file.path)
      if (!language || file.status === 'A') continue
      const before = await showFileAt(git, `${sha}^`, file.path)
      const after = await showFileAt(git, sha, file.path)
      if (!before || !after) continue
      const beforeFingerprints = functionFingerprints(before, language)
      const afterFingerprints = functionFingerprints(after, language)
      const count = Math.max(beforeFingerprints.length, afterFingerprints.length)
      for (let i = 0; i < count; i++) {
        const pre = beforeFingerprints[i]
        const post = afterFingerprints[i]
        if (!pre || !post || pre.hash === post.hash) continue
        const mod = moduleForPath(file.path)
        await backend.store({
          content: `Bug pattern fixed in ${file.path} by ${sha.slice(0, 8)}`,
          role: 'system',
          tags: [
            ...bugTags({ module: mod, language, fingerprint: pre.hash, fixCommit: sha }),
            ...lineageTags,
          ],
          metadata: {
            sha,
            file: file.path,
            language,
            module: mod,
            preFingerprint: pre.hash,
            postFingerprint: post.hash,
            preShape: pre.shape,
            postShape: post.shape,
          },
        })
        result.bugPatternMemories++
        result.memoriesCreated++
      }
    }
  }

  // Context memory — always emitted
  const dirSummary = diffStat.dirsTouched.join(', ') || 'root'
  await backend.store({
    content: `Commit ${sha.slice(0, 8)}: ${subject}. Changed ${diffStat.filesTouched} file(s) (+${diffStat.totalAdditions}/-${diffStat.totalDeletions}) in: ${dirSummary}`,
    role: 'system',
    tags: [...contextTags({ module: primaryModule }), ...lineageTags],
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
        tags: [
          ...conventionTags({
            module: primaryModule,
            language: profile.language,
            pattern: dominant?.pattern,
            score: dominant?.score,
          }),
          ...lineageTags,
        ],
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
