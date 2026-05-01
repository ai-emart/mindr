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
  getContextHealth as coreGetContextHealth,
  checkpointSession as coreCheckpointSession,
  debtTags,
  scoreMemoryQuality,
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
  MindrStats,
  ContextHealthResult,
  QualityBreakdown,
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
  MindrStats,
  ContextHealthResult,
  QualityBreakdown,
}

/** A {@link MindrMemory} enriched with quality scoring from {@link Mindr.query}. */
export interface ScoredMemory extends MindrMemory {
  qualityScore: number
  qualityBreakdown: QualityBreakdown
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

/** Options for {@link Mindr#getDecisions}. */
export interface DecisionsOptions {
  /** Filter to a specific module. */
  module?: string
  /** Only return decisions on or after this date. */
  from?: Date
  /** Only return decisions on or before this date. */
  to?: Date
  /** Maximum results (default 50). */
  limit?: number
}

/** Options for {@link Mindr#getDebt}. */
export interface DebtOptions {
  /** Filter to a specific module. */
  module?: string
  severity?: 'high' | 'medium' | 'low'
  minAge?: number
  /** Maximum results. */
  limit?: number
}

/** Options for {@link Mindr#addDebt}. */
export interface AddDebtOptions {
  file: string
  severity?: 'high' | 'medium' | 'low'
  module?: string
  tags?: MindrTag[]
  metadata?: Record<string, unknown>
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
  /** Primary trigger that classified this commit as a decision (backward-compat). */
  trigger?: string
  /** All triggers that contributed to classifying this commit as a decision. */
  triggers?: string[]
  /** Confidence score in [0, 1] combining signal strength. */
  confidence?: number
  /** Commit body text (everything after the subject line), or null if absent. */
  rationale?: string
  /** Files touched in the commit that produced this decision. */
  filesAffected?: string[]
  /** True when this decision has been marked reversed via `mindr decisions reverse`. */
  reversed?: boolean
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
  severity?: string
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

function toDecision(mem: MindrMemory, reversedIds?: Set<string>): Decision {
  const meta = (mem.metadata ?? {}) as Record<string, unknown>
  const raw = mem.content
  const summary = raw.startsWith('Decision: ') ? raw.slice('Decision: '.length) : raw
  return {
    id: mem.id,
    summary,
    date: typeof meta['date'] === 'string' ? meta['date'] : mem.createdAt.slice(0, 10),
    module: tagValue(mem, 'module'),
    trigger: typeof meta['trigger'] === 'string' ? meta['trigger'] : undefined,
    triggers: Array.isArray(meta['triggers']) ? (meta['triggers'] as string[]) : undefined,
    confidence: typeof meta['confidence'] === 'number' ? (meta['confidence'] as number) : undefined,
    rationale: typeof meta['rationale'] === 'string' ? meta['rationale'] : undefined,
    filesAffected: Array.isArray(meta['filesAffected'])
      ? (meta['filesAffected'] as string[])
      : undefined,
    reversed: reversedIds != null ? reversedIds.has(mem.id) : undefined,
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
    severity: tagValue(mem, 'severity') || (typeof meta['severity'] === 'string' ? meta['severity'] : undefined),
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
  async query(opts: QueryOptions = {}): Promise<ScoredMemory[]> {
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

    return results.map((memory): ScoredMemory => {
      const qualityBreakdown = scoreMemoryQuality(memory)
      return { ...memory, qualityScore: qualityBreakdown.total, qualityBreakdown }
    })
  }

  /**
   * Return all decision memories as structured {@link Decision} objects,
   * newest-first.
   */
  async getDecisions(opts: DecisionsOptions = {}): Promise<Decision[]> {
    const limit = opts.limit ?? 50
    let mems = await queryDecisions(this.backend, limit)

    if (opts.module) {
      mems = mems.filter((m) => m.tags.some((t) => t.key === 'module' && t.value === opts.module))
    }
    if (opts.from) {
      const from = opts.from
      mems = mems.filter((m) => new Date(m.createdAt) >= from)
    }
    if (opts.to) {
      const to = opts.to
      mems = mems.filter((m) => new Date(m.createdAt) <= to)
    }

    const reversedMarkers = await this.backend.listByTags([
      { key: 'reversed_decision', value: 'true' },
    ])
    const reversedIds = new Set(
      reversedMarkers
        .map((m) => m.tags.find((t) => t.key === 'original_decision')?.value)
        .filter((v): v is string => v != null),
    )

    return mems.map((m) => toDecision(m, reversedIds))
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
    if (opts.severity) {
      mems = mems.filter((m) => m.tags.some((t) => t.key === 'severity' && t.value === opts.severity))
    }
    if (opts.minAge != null) {
      const cutoff = Date.now() - opts.minAge * 86400000
      mems = mems.filter((m) => new Date(m.createdAt).getTime() <= cutoff)
    }
    if (opts.limit != null) {
      mems = mems.slice(0, opts.limit)
    }

    return mems.map(toDebtItem)
  }

  async addDebt(content: string, opts: AddDebtOptions): Promise<DebtItem> {
    const module = opts.module ?? (opts.file.includes('/') ? opts.file.split('/')[0] ?? 'root' : 'root')
    const severity = opts.severity ?? 'medium'
    const memory = await this.backend.store({
      content,
      role: 'user',
      tags: [
        ...debtTags({ module, severity }),
        { key: 'source', value: 'manual' },
        ...(opts.tags ?? []),
      ],
      metadata: {
        file: opts.file,
        severity,
        manual: true,
        ...(opts.metadata ?? {}),
      },
    })
    return toDebtItem(memory)
  }

  async resolveDebt(id: string): Promise<MindrMemory> {
    return this.backend.store({
      content: `Manually resolved debt ${id}`,
      role: 'user',
      tags: [
        { key: 'type', value: 'debt_resolved' },
        { key: 'original_debt', value: id },
        { key: 'source', value: 'manual' },
      ],
      metadata: { originalId: id, resolvedAt: new Date().toISOString() },
    })
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

  async getContextHealth(sessionId: string): Promise<ContextHealthResult> {
    return coreGetContextHealth(this.backend, sessionId)
  }

  async checkpointSession(sessionId: string): Promise<MindrMemory> {
    return coreCheckpointSession(this.backend, sessionId)
  }

  async getStats(opts: { session?: string; last?: string } = {}): Promise<MindrStats> {
    const cutoff = (() => {
      if (!opts.last) return null
      const match = /^(\d+)(m|h|d|w)$/i.exec(opts.last)
      if (!match) return null
      const amount = Number.parseInt(match[1]!, 10)
      const unit = match[2]!.toLowerCase()
      const millis =
        unit === 'm' ? amount * 60_000 :
        unit === 'h' ? amount * 3_600_000 :
        unit === 'd' ? amount * 86_400_000 :
        amount * 7 * 86_400_000
      return new Date(Date.now() - millis)
    })()
    const mems = await this.backend.listByTags([{ key: 'type', value: 'metering' }], 1000)
    const filtered = mems.filter((m) => {
      const matchesSession = opts.session
        ? m.sessionId === opts.session || m.tags.some((t) => t.key === 'session' && t.value === opts.session)
        : true
      const matchesWindow = cutoff ? new Date(m.createdAt) >= cutoff : true
      return matchesSession && matchesWindow
    })
    const sessions = new Set<string>()
    let tokensInjected = 0
    let tokensSelfReported = 0
    let estimatedSaved = 0
    for (const mem of filtered) {
      if (mem.sessionId) sessions.add(mem.sessionId)
      const meta = mem.metadata ?? {}
      tokensInjected += typeof meta['tokensInjected'] === 'number' ? meta['tokensInjected'] : 0
      tokensSelfReported += typeof meta['tokensSelfReported'] === 'number' ? meta['tokensSelfReported'] : 0
      estimatedSaved += typeof meta['estimatedSaved'] === 'number' ? meta['estimatedSaved'] : 0
    }
    return {
      sessions: opts.session ? 1 : sessions.size,
      tokensInjected,
      tokensSelfReported,
      estimatedSaved,
      range: { low: Math.round(estimatedSaved * 0.5), high: estimatedSaved },
    }
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
