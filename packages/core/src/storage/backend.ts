import type { MindrTag } from '../schema.js'

export interface MindrMemory {
  id: string
  sessionId?: string | null
  role: string
  content: string
  tags: MindrTag[]
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export interface MindrSession {
  sessionId: string
  metadata?: Record<string, unknown> | null
  createdAt: string
}

export interface StoreParams {
  content: string
  role?: string
  sessionId?: string
  tags?: MindrTag[]
  metadata?: Record<string, unknown>
}

export interface SearchParams {
  query: string
  sessionId?: string
  tags?: MindrTag[]
  limit?: number
  fromTime?: Date
  toTime?: Date
}

export interface MemoryBackend {
  createSession(metadata?: Record<string, unknown>): Promise<MindrSession>
  store(params: StoreParams): Promise<MindrMemory>
  search(params: SearchParams): Promise<MindrMemory[]>
  forget(memoryId: string): Promise<void>
  listByTags(tags: MindrTag[], limit?: number): Promise<MindrMemory[]>
  getById(memoryId: string): Promise<MindrMemory | null>
  /**
   * Find memories whose `git_commit:<sha>` tag matches any SHA in `commits`,
   * OR whose `branch_lineage:<branch>` tag matches any branch in `lineageFallback`.
   * Optionally filter results to those also matching every tag in `additionalTags`.
   * Used for branch-scoped context queries; avoids ghost memories on merge/rebase.
   */
  searchByCommitSet(
    commits: string[],
    lineageFallback: string[],
    additionalTags?: MindrTag[],
  ): Promise<MindrMemory[]>
}
