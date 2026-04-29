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

export type { CommitProcessingResult } from './git/watcher.js'
export { onCommit } from './git/watcher.js'

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
