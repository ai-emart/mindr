import Database from 'better-sqlite3'
import { mkdirSync } from 'fs'
import { join, dirname, isAbsolute } from 'path'
import { randomUUID } from 'crypto'
import { tagsToStrings, tagsFromStrings } from '../schema.js'
import type { MindrTag } from '../schema.js'
import type { MemoryBackend, MindrMemory, MindrSession, StoreParams, SearchParams } from './backend.js'
import type { MindrConfig } from '../config.js'

interface MemoryRow {
  id: string
  content: string
  role: string
  tags: string
  metadata: string | null
  created_at: number
  session_id: string | null
}

function rowToMemory(row: MemoryRow): MindrMemory {
  return {
    id: row.id,
    sessionId: row.session_id,
    role: row.role,
    content: row.content,
    tags: tagsFromStrings(JSON.parse(row.tags) as string[]),
    metadata: row.metadata ? (JSON.parse(row.metadata) as Record<string, unknown>) : null,
    createdAt: new Date(row.created_at).toISOString(),
  }
}

export class SqliteBackend implements MemoryBackend {
  private readonly db: Database.Database

  constructor(config: MindrConfig) {
    const dbPath = isAbsolute(config.storage.sqlite_path)
      ? config.storage.sqlite_path
      : join(process.cwd(), config.storage.sqlite_path)
    mkdirSync(dirname(dbPath), { recursive: true })
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.migrate()
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        metadata TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS memories (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'user',
        tags TEXT NOT NULL DEFAULT '[]',
        metadata TEXT,
        created_at INTEGER NOT NULL,
        deleted_at INTEGER,
        session_id TEXT
      );

      CREATE INDEX IF NOT EXISTS idx_memories_created_at ON memories (created_at);
      CREATE INDEX IF NOT EXISTS idx_memories_session_id ON memories (session_id);

      CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
        content,
        content='memories',
        content_rowid='rowid'
      );

      CREATE TRIGGER IF NOT EXISTS memories_ai AFTER INSERT ON memories BEGIN
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_ad AFTER DELETE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
      END;

      CREATE TRIGGER IF NOT EXISTS memories_au AFTER UPDATE ON memories BEGIN
        INSERT INTO memories_fts(memories_fts, rowid, content) VALUES('delete', old.rowid, old.content);
        INSERT INTO memories_fts(rowid, content) VALUES (new.rowid, new.content);
      END;
    `)
  }

  async createSession(metadata?: Record<string, unknown>): Promise<MindrSession> {
    const id = randomUUID()
    const createdAt = Date.now()
    this.db
      .prepare(`INSERT INTO sessions (id, metadata, created_at) VALUES (?, ?, ?)`)
      .run(id, metadata ? JSON.stringify(metadata) : null, createdAt)
    return {
      sessionId: id,
      metadata: metadata ?? null,
      createdAt: new Date(createdAt).toISOString(),
    }
  }

  async store(params: StoreParams): Promise<MindrMemory> {
    const id = randomUUID()
    const createdAt = Date.now()
    const tags = params.tags ? tagsToStrings(params.tags) : []
    this.db
      .prepare(
        `INSERT INTO memories (id, content, role, tags, metadata, created_at, session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        params.content,
        params.role ?? 'user',
        JSON.stringify(tags),
        params.metadata ? JSON.stringify(params.metadata) : null,
        createdAt,
        params.sessionId ?? null,
      )
    return {
      id,
      sessionId: params.sessionId ?? null,
      role: params.role ?? 'user',
      content: params.content,
      tags: params.tags ?? [],
      metadata: params.metadata ?? null,
      createdAt: new Date(createdAt).toISOString(),
    }
  }

  async search(params: SearchParams): Promise<MindrMemory[]> {
    const limit = params.limit ?? 20
    let rows: MemoryRow[]

    if (params.sessionId) {
      rows = this.db
        .prepare(
          `SELECT m.id, m.content, m.role, m.tags, m.metadata, m.created_at, m.session_id
           FROM memories m
           JOIN memories_fts f ON m.rowid = f.rowid
           WHERE memories_fts MATCH ?
             AND m.deleted_at IS NULL
             AND m.session_id = ?
           ORDER BY m.created_at DESC
           LIMIT ?`,
        )
        .all(params.query, params.sessionId, limit) as MemoryRow[]
    } else {
      rows = this.db
        .prepare(
          `SELECT m.id, m.content, m.role, m.tags, m.metadata, m.created_at, m.session_id
           FROM memories m
           JOIN memories_fts f ON m.rowid = f.rowid
           WHERE memories_fts MATCH ?
             AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC
           LIMIT ?`,
        )
        .all(params.query, limit) as MemoryRow[]
    }

    return rows.map(rowToMemory)
  }

  async forget(memoryId: string): Promise<void> {
    this.db
      .prepare(`UPDATE memories SET deleted_at = ? WHERE id = ?`)
      .run(Date.now(), memoryId)
  }

  async listByTags(tags: MindrTag[], limit = 50): Promise<MindrMemory[]> {
    if (tags.length === 0) {
      const rows = this.db
        .prepare(
          `SELECT id, content, role, tags, metadata, created_at, session_id
           FROM memories WHERE deleted_at IS NULL ORDER BY created_at DESC LIMIT ?`,
        )
        .all(limit) as MemoryRow[]
      return rows.map(rowToMemory)
    }

    const tagStrings = tagsToStrings(tags)
    const placeholders = tagStrings.map(() => '?').join(', ')
    const rows = this.db
      .prepare(
        `SELECT DISTINCT m.id, m.content, m.role, m.tags, m.metadata, m.created_at, m.session_id
         FROM memories m, json_each(m.tags) t
         WHERE t.value IN (${placeholders})
           AND m.deleted_at IS NULL
         ORDER BY m.created_at DESC
         LIMIT ?`,
      )
      .all(...tagStrings, limit) as MemoryRow[]
    return rows.map(rowToMemory)
  }

  async searchByCommitSet(
    commits: string[],
    lineageFallback: string[],
    additionalTags?: MindrTag[],
  ): Promise<MindrMemory[]> {
    // Build the full list of tag strings to match (OR semantics across the set).
    const commitTagStrings = commits.map((sha) => `mindr:git_commit:${sha}`)
    const lineageTagStrings = lineageFallback.map((b) => `mindr:branch_lineage:${b}`)
    const allTagStrings = [...commitTagStrings, ...lineageTagStrings]

    if (allTagStrings.length === 0) return []

    // SQLite has a ~999-parameter limit per statement; chunk large sets.
    const CHUNK = 900
    const seen = new Set<string>()
    const results: MindrMemory[] = []

    for (let i = 0; i < allTagStrings.length; i += CHUNK) {
      const chunk = allTagStrings.slice(i, i + CHUNK)
      const placeholders = chunk.map(() => '?').join(', ')
      const rows = this.db
        .prepare(
          `SELECT DISTINCT m.id, m.content, m.role, m.tags, m.metadata, m.created_at, m.session_id
           FROM memories m, json_each(m.tags) t
           WHERE t.value IN (${placeholders})
             AND m.deleted_at IS NULL
           ORDER BY m.created_at DESC`,
        )
        .all(...chunk) as MemoryRow[]

      for (const row of rows) {
        if (!seen.has(row.id)) {
          seen.add(row.id)
          results.push(rowToMemory(row))
        }
      }
    }

    if (additionalTags && additionalTags.length > 0) {
      return results.filter((m) =>
        additionalTags.every((at) => m.tags.some((mt) => mt.key === at.key && mt.value === at.value)),
      )
    }

    return results
  }

  async getById(memoryId: string): Promise<MindrMemory | null> {
    const row = this.db
      .prepare(
        `SELECT id, content, role, tags, metadata, created_at, session_id
         FROM memories WHERE id = ? AND deleted_at IS NULL`,
      )
      .get(memoryId) as MemoryRow | undefined
    return row ? rowToMemory(row) : null
  }

  close(): void {
    this.db.close()
  }
}
