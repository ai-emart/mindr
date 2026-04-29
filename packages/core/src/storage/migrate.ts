import type { MindrConfig } from '../config.js'
import { SqliteBackend } from './sqlite-backend.js'
import { RemembrBackend } from './remembr-backend.js'

export async function migrateSqliteToRemembr(config: MindrConfig): Promise<{ migrated: number }> {
  const sqlite = new SqliteBackend({
    ...config,
    storage: { ...config.storage, backend: 'sqlite' },
  })
  try {
    const remembr = new RemembrBackend(config)

    // Load all memories; 100k is a safe upper bound for a dev machine SQLite store
    const memories = await sqlite.listByTags([], 100_000)
    let migrated = 0

    for (const memory of memories) {
      await remembr.store({
        content: memory.content,
        role: memory.role,
        sessionId: memory.sessionId ?? undefined,
        tags: memory.tags,
        metadata: memory.metadata ?? undefined,
      })
      migrated++
    }

    return { migrated }
  } finally {
    sqlite.close()
  }
}
