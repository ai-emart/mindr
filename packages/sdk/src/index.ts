/**
 * @ai-emart/mindr — developer SDK
 *
 * Wraps the core MemoryBackend with a clean, typed API.
 * Does NOT depend on the CLI package.
 */

import { writeFileSync } from 'fs'
import { resolve } from 'path'
import {
  loadConfig,
  getBackend,
  buildSessionContext,
  queryConventions,
  queryDecisions,
  queryDebt,
  generateAgentsMd as coreGenerateAgentsMd,
  generateClaudeMd as coreGenerateClaudeMd,
  MEMORY_TYPES,
  migrateSqliteToRemembr as coreMigrate,
} from '@ai-emart/mindr-core'
import type {
  MemoryBackend,
  MindrMemory,
  MindrConfig,
  SessionContextOptions,
  SessionContext,
  ConventionProfile,
  MindrTag,
  MemoryType,
  HotModule,
} from '@ai-emart/mindr-core'

// ---------------------------------------------------------------------------
// Re-exports — types consumers need without importing core directly
// ---------------------------------------------------------------------------

export type {
  MemoryBackend,
  MindrMemory,
  MindrConfig,
  MindrTag,
  MemoryType,
  SessionContext,
  SessionContextOptions,
  ConventionProfile,
  HotModule,
}
export { MEMORY_TYPES }

// ---------------------------------------------------------------------------
// Input option types
// ---------------------------------------------------------------------------

/** Options for {@link Mindr.open}. */
export interface MindrOpenOptions {
  /** Absolute or relative path to the project root. */
  project: string
  /**
   * Inject a pre-built backend — skips config loading and backend creation.
   * Useful for testing and custom integrations.
   */
  backend?: MemoryBackend
  /**
   * Inject a pre-built config — skips `.mindr/config.toml` discovery.
   * Useful for testing and programmatic setup.
   */
  config?: MindrConfig
}

/** Options for {@link Mindr#remember}. */
export interface RememberOptions {
  /** Memory type — shapes how the memory is surfaced later. */
  type?: MemoryType
  /** Module or area this memory belongs to (e.g. `'api'`, `'auth'`). */
  module?: string
  /** Additional key:value tags to attach. */
  tags?: MindrTag[]
  /** Arbitrary metadata stored alongside the memory content. */
  metadata?: Record<string, unknown>
}

/** Options for {@link Mindr#query}. */
export interface QueryOptions {
  /** Filter by memory type. */
  type?: MemoryType
  /** Filter by module. */
  module?: string
  /** Only return memories created at or after this date. */
  since?: Date
  /** Maximum results (default 50). */
  limit?: number
}

/** Options for {@link Mindr#getDebt}. */
export interface DebtOptions {
  /** Filter to a specific module. */
  module?: string
  /** Maximum results. */
  limit?: number
}

/** Options for {@link Mindr#getConventions}. */
export interface ConventionsOptions {
  /** Filter to a specific language (e.g. `'typescript'`, `'python'`). */
  language?: string
}

/** Options for {@link Mindr#regenerateAgentsMd}. */
export interface RegenerateOptions {
  /**
   * Which file to generate.
   * - `'agents-md'` (default) — generates `AGENTS.md`
   * - `'claude-md'` — generates `CLAUDE.md`
   * - `'all'` — generates both
   */
  target?: 'agents-md' | 'claude-md' | 'all'
  /** Custom output path for AGENTS.md. Defaults to `<project>/AGENTS.md`. */
  agentsMdPath?: string
  /** Custom output path for CLAUDE.md. Defaults to `<project>/CLAUDE.md`. */
  claudeMdPath?: string
}

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

/** A parsed decision memory, stripped of the storage format. */
export interface Decision {
  id: string
  /** Decision text with the `"Decision: "` prefix removed. */
  summary: string
  /** ISO date string (YYYY-MM-DD). */
  date: string
  /** Module this decision belongs to. */
  module: string
  /** What triggered the decision — `'keyword'`, `'manual'`, etc. */
  trigger?: string
  /** Full ISO 8601 timestamp the memory was created. */
  createdAt: string
}

/** A parsed debt item (TODO / FIXME / HACK). */
export interface DebtItem {
  id: string
  /** Raw content string. */
  content: string
  /** `file:line` location string, or empty when unavailable. */
  location: string
  /** The debt keyword: `TODO`, `FIXME`, `HACK`, `XXX`. */
  keyword: string
  /** Source file path (from metadata). */
  file?: string
  /** Line number (from metadata). */
  line?: number
  /** Module this debt belongs to. */
  module: string
  createdAt: string
}

/** Snapshot of the Mindr instance's current state. */
export interface MindrStatus {
  /** Storage backend in use: `'sqlite'` or `'remembr'`. */
  backendType: 'sqlite' | 'remembr'
  /** Resolved absolute path to the project root. */
  projectPath: string
  /** Number of stored memories per {@link MemoryType}. */
  memoryCounts: Record<string, number>
}

/** Output of {@link Mindr#regenerateAgentsMd}. */
export interface RegenerateResult {
  /** Generated AGENTS.md content, if requested. */
  agentsMd?: string
  /** Generated CLAUDE.md content, if requested. */
  claudeMd?: string
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function tagValue(mem: MindrMemory, key: string): string {
  return mem.tags.find((t) => t.key === key)?.value ?? ''
}

function toDecision(mem: MindrMemory): Decision {
  const meta = (mem.metadata ?? {}) as Record<string, unknown>
  const raw = mem.content
  const summary = raw.startsWith('Decision: ') ? raw.slice('Decision: '.length) : raw
  return {
    id: mem.id,
    summary,
    date: typeof meta['date'] === 'string' ? meta['date'] : mem.createdAt.slice(0, 10),
    module: tagValue(mem, 'module'),
    trigger: typeof meta['trigger'] === 'string' ? meta['trigger'] : undefined,
    createdAt: mem.createdAt,
  }
}

function toDebtItem(mem: MindrMemory): DebtItem {
  const meta = (mem.metadata ?? {}) as Record<string, unknown>
  const file = typeof meta['file'] === 'string' ? meta['file'] : undefined
  const line = typeof meta['line'] === 'number' ? meta['line'] : undefined
  const keyword = typeof meta['keyword'] === 'string' ? meta['keyword'] : 'TODO'
  const location = file != null ? (line != null ? `${file}:${line}` : file) : ''
  return {
    id: mem.id,
    content: mem.content,
    location,
    keyword,
    file,
    line,
    module: tagValue(mem, 'module'),
    createdAt: mem.createdAt,
  }
}

// ---------------------------------------------------------------------------
// Main class
// ---------------------------------------------------------------------------

export class Mindr {
  private constructor(
    private readonly repoRoot: string,
    private readonly config: MindrConfig,
    private readonly backend: MemoryBackend,
  ) {}

  // -------------------------------------------------------------------------
  // Factory
  // -------------------------------------------------------------------------

  /**
   * Open a Mindr client for the given project path.
   *
   * Loads `.mindr/config.toml` (walking up from `opts.project`),
   * connects to the configured backend, and returns a ready client.
   *
   * @example
   * ```ts
   * const mindr = await Mindr.open({ project: './my-project' });
   * ```
   */
  static async open(opts: MindrOpenOptions): Promise<Mindr> {
    const repoRoot = resolve(opts.project)
    const config = opts.config ?? loadConfig(repoRoot)
    const backend = opts.backend ?? getBackend(config)
    return new Mindr(repoRoot, config, backend)
  }

  /**
   * Release any resources held by the backend (e.g. SQLite file handles).
   * Call this when you are done with the client.
   */
  close(): void {
    // SqliteBackend exposes close(); other backends may not.
    const b = this.backend as { close?: () => void }
    b.close?.()
  }

  // -------------------------------------------------------------------------
  // Write
  // -------------------------------------------------------------------------

  /**
   * Store a memory string with optional type, module, and tags.
   *
   * @example
   * ```ts
   * await mindr.remember('We use tRPC for all internal APIs', {
   *   type: 'decision',
   *   module: 'api',
   * });
   * ```
   */
  async remember(content: string, opts: RememberOptions = {}): Promise<MindrMemory> {
    const tags: MindrTag[] = []
    if (opts.type) tags.push({ key: 'type', value: opts.type })
    if (opts.module) tags.push({ key: 'module', value: opts.module })
    if (opts.tags) tags.push(...opts.tags)

    return this.backend.store({ content, role: 'user', tags, metadata: opts.metadata })
  }

  /**
   * Soft-delete a memory by ID.
   *
   * @example
   * ```ts
   * await mindr.forget(mem.id);
   * ```
   */
  async forget(id: string): Promise<void> {
    return this.backend.forget(id)
  }

  // -------------------------------------------------------------------------
  // Query
  // -------------------------------------------------------------------------

  /**
   * List raw {@link MindrMemory} records matching the given filters.
   *
   * Uses a single-tag SQL query for the `type` filter, then applies
   * `module` and `since` filters in JavaScript (avoids backend OR semantics
   * for multi-tag queries).
   */
  async query(opts: QueryOptions = {}): Promise<MindrMemory[]> {
    // Single-tag SQL fetch — safe for both SqliteBackend and RemembrBackend
    const primaryTags: MindrTag[] = opts.type ? [{ key: 'type', value: opts.type }] : []
    let results = await this.backend.listByTags(primaryTags, opts.limit ?? 50)

    // JS post-filters
    if (opts.module) {
      results = results.filter((m) =>
        m.tags.some((t) => t.key === 'module' && t.value === opts.module),
      )
    }
    if (opts.since) {
      const since = opts.since
      results = results.filter((m) => new Date(m.createdAt) >= since)
    }

    return results
  }

  /**
   * Return all decision memories as structured {@link Decision} objects,
   * newest-first.
   */
  async getDecisions(opts: QueryOptions = {}): Promise<Decision[]> {
    // queryDecisions already sorts newest-first and uses a single type tag
    const limit = opts.limit ?? 50
    let mems = await queryDecisions(this.backend, limit)

    if (opts.module) {
      mems = mems.filter((m) => m.tags.some((t) => t.key === 'module' && t.value === opts.module))
    }
    if (opts.since) {
      const since = opts.since
      mems = mems.filter((m) => new Date(m.createdAt) >= since)
    }

    return mems.map(toDecision)
  }

  /**
   * Return all active debt items (TODO / FIXME / HACK) as structured
   * {@link DebtItem} objects.
   */
  async getDebt(opts: DebtOptions = {}): Promise<DebtItem[]> {
    let mems = await queryDebt(this.backend)

    if (opts.module) {
      mems = mems.filter((m) => m.tags.some((t) => t.key === 'module' && t.value === opts.module))
    }
    if (opts.limit != null) {
      mems = mems.slice(0, opts.limit)
    }

    return mems.map(toDebtItem)
  }

  /**
   * Return the stored {@link ConventionProfile} for each detected language.
   *
   * Profiles are extracted from convention memories stored by the post-commit
   * hook or `mindr init`.
   */
  async getConventions(opts: ConventionsOptions = {}): Promise<ConventionProfile[]> {
    // queryConventions handles deduplication (latest per language)
    let profiles = await queryConventions(this.backend)

    if (opts.language) {
      profiles = profiles.filter((p) => p.language === opts.language)
    }

    return profiles
  }

  // -------------------------------------------------------------------------
  // Context
  // -------------------------------------------------------------------------

  /**
   * Build a token-aware session context block suitable for injecting into an
   * AI agent's system prompt.
   *
   * @example
   * ```ts
   * const ctx = await mindr.getSessionContext({ module: 'auth', max_tokens: 2000 });
   * console.log(ctx.summary); // === MINDR CONTEXT === …
   * ```
   */
  async getSessionContext(opts: SessionContextOptions = {}): Promise<SessionContext> {
    return buildSessionContext(this.backend, opts)
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  /**
   * Return a snapshot of the Mindr instance — backend type, project path,
   * and per-type memory counts.
   */
  async getStatus(): Promise<MindrStatus> {
    const counts: Record<string, number> = {}
    await Promise.all(
      MEMORY_TYPES.map(async (type) => {
        const mems = await this.backend.listByTags([{ key: 'type', value: type }])
        counts[type] = mems.length
      }),
    )
    return {
      backendType: this.config.storage.backend,
      projectPath: this.repoRoot,
      memoryCounts: counts,
    }
  }

  // -------------------------------------------------------------------------
  // Generate
  // -------------------------------------------------------------------------

  /**
   * (Re-)generate `AGENTS.md` and/or `CLAUDE.md` from observed patterns and
   * stored memories.  Writes the file(s) to disk and returns the content.
   *
   * @example
   * ```ts
   * const { agentsMd } = await mindr.regenerateAgentsMd();
   * ```
   */
  async regenerateAgentsMd(opts: RegenerateOptions = {}): Promise<RegenerateResult> {
    const target = opts.target ?? 'agents-md'
    const result: RegenerateResult = {}

    if (target === 'agents-md' || target === 'all') {
      const md = await coreGenerateAgentsMd(this.repoRoot, this.backend)
      const outPath = opts.agentsMdPath ?? resolve(this.repoRoot, 'AGENTS.md')
      writeFileSync(outPath, md, 'utf8')
      result.agentsMd = md
    }

    if (target === 'claude-md' || target === 'all') {
      const md = await coreGenerateClaudeMd(this.repoRoot, this.backend)
      const outPath = opts.claudeMdPath ?? resolve(this.repoRoot, 'CLAUDE.md')
      writeFileSync(outPath, md, 'utf8')
      result.claudeMd = md
    }

    return result
  }

  // -------------------------------------------------------------------------
  // Migration
  // -------------------------------------------------------------------------

  /**
   * Copy all memories from the local SQLite store to the Remembr cloud
   * backend.  Requires the config to have `storage.backend = "remembr"` and
   * valid Remembr credentials.
   */
  async migrateSqliteToRemembr(): Promise<{ migrated: number }> {
    return coreMigrate(this.config)
  }
}

export const VERSION = '0.0.1'
