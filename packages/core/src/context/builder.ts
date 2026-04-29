// Session context builder — token-aware, priority-ordered summary for AI agents.

import type { MemoryBackend, MindrMemory } from '../storage/backend.js'
import type { ConventionProfile } from '../conventions/detector.js'
import { branchMemoryQuery } from '../git/lineage.js'
import { scoreMemoryQuality } from '../quality/score.js'

// ---------------------------------------------------------------------------

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionContextOptions {
  module?: string
  files?: string[]
  max_tokens?: number
  recentDecisions?: number    // default 5
  recentCommitDays?: number   // default 30
  /** Limit context to memories reachable from this branch (requires repoRoot). */
  branch?: string
  /** Absolute path to the repository root; required when `branch` is set. */
  repoRoot?: string
}

export interface HotModule {
  module: string
  touches: number
}

export interface SessionContext {
  stack: string[]                                              // language names from convention profiles
  conventions: Array<{ language: string; rules: string[] }>  // top rules per language
  decisions: Array<{ date: string; summary: string; trigger?: string }>
  hotModules: HotModule[]
  warnings: Array<{ keyword: string; location: string; text: string }>
  summary: string       // full rendered text, possibly token-trimmed
  tokensUsed: number
  droppedSections: string[]
}

// Section priority: higher = kept longer when trimming.
// Drop order when over budget: stack (0) → conventions (1) → hotModules (2) → decisions (3) → warnings (4)
const SECTION_PRIORITY = {
  stack:       0,
  conventions: 1,
  hotModules:  2,
  decisions:   3,
  warnings:    4,
} as const

type SectionName = keyof typeof SECTION_PRIORITY

// ---------------------------------------------------------------------------
// Token estimation (rough: 1 token ≈ 4 chars)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderStack(stack: string[]): string {
  if (stack.length === 0) return ''
  return `[STACK]\n${stack.join(' | ')}\n`
}

function renderConventions(conventions: SessionContext['conventions']): string {
  if (conventions.length === 0) return ''
  const lines = conventions.map((c) => {
    const rules = c.rules.join(', ')
    return `  ${c.language}: ${rules}`
  })
  return `[CONVENTIONS]\n${lines.join('\n')}\n`
}

function renderHotModules(mods: HotModule[]): string {
  if (mods.length === 0) return ''
  const lines = mods.map((m) => `  ${m.module} (${m.touches} commits)`)
  return `[HOT MODULES — last 30d]\n${lines.join('\n')}\n`
}

function renderDecisions(decisions: SessionContext['decisions']): string {
  if (decisions.length === 0) return ''
  const lines = decisions.map((d) => {
    const trigger = d.trigger ? ` [${d.trigger}]` : ''
    return `  ${d.date} — ${d.summary}${trigger}`
  })
  return `[RECENT DECISIONS]\n${lines.join('\n')}\n`
}

function renderWarnings(warnings: SessionContext['warnings']): string {
  if (warnings.length === 0) return ''
  const lines = warnings.map((w) => `  ${w.keyword} \`${w.location}\` — ${w.text}`)
  return `[WARNINGS]\n${lines.join('\n')}\n`
}

// ---------------------------------------------------------------------------
// Data queries
// ---------------------------------------------------------------------------

type ListByType = (type: string) => Promise<MindrMemory[]>

async function fetchConventions(listByType: ListByType): Promise<ConventionProfile[]> {
  const mems = await listByType('convention')
  mems.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latestByLang = new Map<string, ConventionProfile>()
  for (const m of mems) {
    const lang = m.tags.find((t) => t.key === 'language')?.value
    if (lang && !latestByLang.has(lang) && m.metadata?.profile) {
      latestByLang.set(lang, m.metadata.profile as ConventionProfile)
    }
  }
  return Array.from(latestByLang.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
}

async function fetchHotModules(listByType: ListByType, days: number): Promise<HotModule[]> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - days)
  const mems = await listByType('context')
  const recent = mems.filter((m) => new Date(m.createdAt) >= cutoff)
  const counts = new Map<string, number>()
  for (const m of recent) {
    const mod = m.tags.find((t) => t.key === 'module')?.value ?? 'root'
    counts.set(mod, (counts.get(mod) ?? 0) + 1)
  }
  return Array.from(counts.entries())
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([module, touches]) => ({ module, touches }))
}

async function fetchDecisions(
  listByType: ListByType,
  limit: number,
): Promise<SessionContext['decisions']> {
  const mems = await listByType('decision')
  return mems
    .sort((a, b) => {
      const quality = scoreMemoryQuality(b).total - scoreMemoryQuality(a).total
      return quality !== 0 ? quality : b.createdAt.localeCompare(a.createdAt)
    })
    .slice(0, limit)
    .map((m) => ({
      date: m.metadata?.['date']
        ? String(m.metadata['date']).slice(0, 10)
        : m.createdAt.slice(0, 10),
      summary: m.content.replace(/^Decision:\s*/i, ''),
      trigger: m.metadata?.['trigger'] ? String(m.metadata['trigger']) : undefined,
    }))
}

async function fetchWarnings(listByType: ListByType, files?: string[]): Promise<SessionContext['warnings']> {
  const mems = await listByType('debt')
  const fileSet = files && files.length > 0 ? new Set(files) : null
  const filtered = fileSet
    ? mems.filter((m) => typeof m.metadata?.['file'] === 'string' && fileSet.has(String(m.metadata['file'])))
    : mems
  const severityRank = (m: MindrMemory): number => {
    const severity = m.tags.find((t) => t.key === 'severity')?.value ?? m.metadata?.['severity']
    if (severity === 'high') return 3
    if (severity === 'medium') return 2
    return 1
  }
  const perFile = new Map<string, number>()
  return filtered
    .sort((a, b) => severityRank(b) - severityRank(a) || a.content.localeCompare(b.content))
    .filter((m) => {
      const file = typeof m.metadata?.['file'] === 'string' ? String(m.metadata['file']) : 'unknown'
      const count = perFile.get(file) ?? 0
      if (count >= 3) return false
      perFile.set(file, count + 1)
      return true
    })
    .map((m) => ({
      keyword: m.metadata?.['keyword'] ? String(m.metadata['keyword']) : 'DEBT',
      location: m.metadata?.['file']
        ? `${m.metadata['file']}:${m.metadata['line']}`
        : 'unknown',
      text: m.content.replace(/^(TODO|FIXME|HACK|XXX) at [^—]+— /i, ''),
    }))
}

// ---------------------------------------------------------------------------
// Main builder
// ---------------------------------------------------------------------------

export async function buildSessionContext(
  backend: MemoryBackend,
  options: SessionContextOptions = {},
): Promise<SessionContext> {
  const {
    max_tokens,
    recentDecisions = 5,
    recentCommitDays = 30,
    branch,
    repoRoot,
    files,
  } = options

  // When branch + repoRoot are provided, scope all queries to commits reachable
  // from that branch (exact SHA match OR branch_lineage fallback).
  let listByType: ListByType
  if (branch && repoRoot) {
    const query = await branchMemoryQuery(repoRoot, branch)
    listByType = (type: string) =>
      backend.searchByCommitSet(query.commits, query.lineageFallback, [
        { key: 'type', value: type },
      ])
  } else {
    listByType = (type: string) => backend.listByTags([{ key: 'type', value: type }])
  }

  // Gather all data in parallel
  const [profiles, hotModules, decisions, warnings] = await Promise.all([
    fetchConventions(listByType),
    fetchHotModules(listByType, recentCommitDays),
    fetchDecisions(listByType, recentDecisions),
    fetchWarnings(listByType, files),
  ])

  // Build derived structures
  const stack = profiles.map((p) => p.language)

  const conventions = profiles.map((p) => ({
    language: p.language,
    rules: p.conventions
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((c) => `${c.category}=${c.pattern}(${c.score}%)`),
  }))

  // Render all sections
  const sections: Record<SectionName, string> = {
    stack:       renderStack(stack),
    conventions: renderConventions(conventions),
    hotModules:  renderHotModules(hotModules),
    decisions:   renderDecisions(decisions),
    warnings:    renderWarnings(warnings),
  }

  // If no max_tokens, include all non-empty sections
  const sortedByPriority = (Object.keys(SECTION_PRIORITY) as SectionName[])
    .sort((a, b) => SECTION_PRIORITY[b] - SECTION_PRIORITY[a])  // highest priority first

  const droppedSections: string[] = []

  if (max_tokens !== undefined) {
    const header = '=== MINDR CONTEXT ===\n\n'
    const footer = '\n=== END CONTEXT ===\n'
    const fixed = estimateTokens(header + footer)

    // Drop lowest-priority sections first until under budget
    const dropOrder: SectionName[] = (Object.keys(SECTION_PRIORITY) as SectionName[])
      .sort((a, b) => SECTION_PRIORITY[a] - SECTION_PRIORITY[b]) // lowest priority first

    let used = fixed + Object.values(sections).reduce((s, v) => s + estimateTokens(v), 0)

    for (const name of dropOrder) {
      if (used <= max_tokens) break
      if (sections[name]) {
        used -= estimateTokens(sections[name])
        droppedSections.push(name)
        sections[name] = ''
      }
    }
  }

  const body = sortedByPriority
    .map((name) => sections[name])
    .filter(Boolean)
    .join('\n')

  const summary = `=== MINDR CONTEXT ===\n\n${body}\n=== END CONTEXT ===\n`

  return {
    stack,
    conventions,
    decisions,
    hotModules,
    warnings,
    summary,
    tokensUsed: estimateTokens(summary),
    droppedSections,
  }
}
