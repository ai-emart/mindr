export const VERSION = '0.0.1'

export type { MindrConfig } from './config.js'
export { loadConfig } from './config.js'

export type { MindrTag, MemoryType } from './schema.js'
export {
  MEMORY_TYPES,
  tagsToStrings,
  tagsFromStrings,
  decisionTags,
  bugTags,
  conventionTags,
  debtTags,
  sessionCheckpointTags,
  noteTags,
  contextTags,
} from './schema.js'

export type {
  MemoryBackend,
  MindrMemory,
  MindrSession,
  StoreParams,
  SearchParams,
} from './storage/backend.js'

export { getBackend } from './storage/factory.js'
export { migrateSqliteToRemembr } from './storage/migrate.js'

export { RemembrBackend } from './storage/remembr-backend.js'
export { SqliteBackend } from './storage/sqlite-backend.js'

export type {
  SimpleGit,
  CommitFileChange,
  CommitInfo,
  DiffStat,
} from './git/repo.js'
export {
  NotARepoError,
  makeGit,
  getRepoRoot,
  getCurrentBranch,
  getHeadCommit,
  getCommitsReachable,
  getCommitInfo,
  getDiffStat,
} from './git/repo.js'

export { installPostCommitHook, uninstallPostCommitHook } from './git/hooks.js'

export type { CommitProcessingResult, DecisionTrigger } from './git/watcher.js'
export { onCommit, computeConfidence, extractRationale } from './git/watcher.js'

export type { BranchMemoryQuery } from './git/lineage.js'
export { reachableCommits, branchMemoryQuery } from './git/lineage.js'

export type {
  Convention,
  ConventionProfile,
  DetectOptions,
} from './conventions/detector.js'
export { detect } from './conventions/detector.js'
export { updateForChangedFiles } from './conventions/incremental.js'
export {
  classifyIdentifier,
  classifyFileName,
  classifyTestPattern,
  isTestFile,
  consistencyScore,
  dominantStyle,
} from './conventions/patterns.js'

export type { SessionContextOptions, SessionContext, HotModule } from './context/builder.js'
export { buildSessionContext } from './context/builder.js'
export type { SessionActivity, ContextHealthResult, ContextHealthRecommendation } from './context/health.js'
export { scoreContextHealth } from './context/health.js'
export { getContextHealth, checkpointSession, healthFromActivity } from './context/checkpoint.js'
export { fingerprint, structuralShape, functionFingerprints, type FunctionFingerprint } from './bugs/fingerprint.js'
export { checkForBugPatterns, type BugPatternCheck, type BugPatternMatch } from './bugs/match.js'
export { detectDebtInText, detectDebtInUnifiedDiff, inferDebtSeverity, type DebtMarker, type DebtSeverity } from './debt/detector.js'
export { estimateTokens, estimateSavings, type TokenSavingsEstimate } from './metering/tokens.js'
export { getStats, type MindrStats } from './metering/stats.js'
export { scoreMemoryQuality, type QualityBreakdown, type QualityStats } from './quality/score.js'

export type { ProjectMeta, StackItem, StackCategory, GenerateContext } from './generate/context.js'
export { gatherContext, getProjectMeta, detectStack, queryConventions, queryDecisions, queryDebt } from './generate/context.js'

export {
  SIGNATURE as AGENTS_MD_SIGNATURE,
  OverwriteError,
  checkExistingFile,
  type GenerateOptions,
} from './generate/agents-md.js'
export { generateAgentsMd } from './generate/agents-md.js'
export { generateClaudeMd } from './generate/claude-md.js'
