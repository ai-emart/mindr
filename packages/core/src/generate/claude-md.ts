// CLAUDE.md generator — Claude Code instruction file format.

import type { MemoryBackend } from '../storage/backend.js'
import type { GenerateContext } from './context.js'
import type { Convention, ConventionProfile } from '../conventions/detector.js'
import { gatherContext } from './context.js'
import { SIGNATURE, type GenerateOptions } from './agents-md.js'

export { SIGNATURE }
export type { GenerateOptions }

// ---------------------------------------------------------------------------
// Rendering helpers (Claude Code style: imperative, prescriptive)
// ---------------------------------------------------------------------------

const PATTERN_IMPERATIVE: Record<string, string> = {
  camelCase:      'Use camelCase',
  PascalCase:     'Use PascalCase',
  snake_case:     'Use snake_case',
  SCREAMING_SNAKE:'Use SCREAMING_SNAKE_CASE',
  'kebab-case':   'Use kebab-case',
  lowercase:      'Use all-lowercase',
}

const CATEGORY_LABELS: Record<string, string> = {
  functionNames:   'Function / method names',
  variableNames:   'Variable names',
  classNames:      'Class / type names',
  fileNames:       'File names',
  testFilePattern: 'Test file location',
}

function conventionRule(c: Convention): string {
  const prefix = PATTERN_IMPERATIVE[c.pattern] ?? `Use \`${c.pattern}\``
  const label = CATEGORY_LABELS[c.category] ?? c.category
  return `- ${prefix} for **${label}** (${c.score}% consistency, ${c.sampleCount} samples)`
}

function renderConventions(conventions: ConventionProfile[]): string {
  if (conventions.length === 0) {
    return '_No convention data yet. Run `mindr generate claude-md` after more commits._\n'
  }
  const out: string[] = []
  for (const profile of conventions) {
    out.push(`### ${profile.language.charAt(0).toUpperCase() + profile.language.slice(1)}`)
    out.push('')
    const top = profile.conventions
      .slice()
      .sort((a, b) => b.score - a.score)
      .slice(0, 5)
    if (top.length === 0) {
      out.push('_Insufficient samples._')
    } else {
      out.push(...top.map(conventionRule))
    }
    out.push('')
  }
  return out.join('\n')
}

function renderStack(stack: GenerateContext['stack']): string {
  if (stack.length === 0) return '_Could not detect stack._\n'
  return stack.map((s) => `- **${s.name}** — ${s.role}`).join('\n') + '\n'
}

function renderDecisions(decisions: GenerateContext['decisions']): string {
  if (decisions.length === 0) return '_No decisions recorded._\n'
  return decisions
    .map((d) => {
      const date = d.metadata?.['date']
        ? String(d.metadata['date']).slice(0, 10)
        : d.createdAt.slice(0, 10)
      const body = d.content.replace(/^Decision:\s*/i, '')
      const trigger = d.metadata?.['trigger'] ? ` *(${String(d.metadata['trigger'])})*` : ''
      return `- **${date}** — ${body}${trigger}`
    })
    .join('\n') + '\n'
}

function renderDebt(debt: GenerateContext['debt']): string {
  if (debt.length === 0) return '_No active debt items._\n'
  return debt
    .map((d) => {
      const file = d.metadata?.['file'] ? `\`${d.metadata['file']}:${d.metadata['line']}\`` : null
      const keyword = d.metadata?.['keyword'] ? `**${d.metadata['keyword']}**` : null
      const body = d.content.replace(/^(TODO|FIXME|HACK|XXX) at [^—]+— /i, '')
      return `- ${[file, keyword, body].filter(Boolean).join(' — ')}`
    })
    .join('\n') + '\n'
}

// ---------------------------------------------------------------------------
// CLAUDE.md renderer
// ---------------------------------------------------------------------------

export async function generateClaudeMd(
  repoRoot: string,
  backend: MemoryBackend,
  opts: GenerateOptions = {},
): Promise<string> {
  const ctx = opts.context ?? await gatherContext(repoRoot, backend)
  const { meta, stack, conventions, decisions, debt } = ctx

  const lines: string[] = []

  lines.push(SIGNATURE)
  lines.push('')
  lines.push(`# ${meta.name}`)
  lines.push('')
  if (meta.description) {
    lines.push(meta.description)
    lines.push('')
  }
  if (meta.repoUrl) {
    lines.push(`> Repository: ${meta.repoUrl}`)
    lines.push('')
  }

  // --- Project Overview ---
  lines.push('## Project Overview')
  lines.push('')
  const langStr = meta.language !== 'unknown' ? `${meta.language} project` : 'project'
  const stackNames = stack.map((s) => s.name)
  const stackStr =
    stackNames.length > 0
      ? ` using ${stackNames.slice(0, 4).join(', ')}${stackNames.length > 4 ? ` +${stackNames.length - 4} more` : ''}`
      : ''
  lines.push(`This is a **${langStr}**${stackStr}.`)
  if (meta.version && meta.version !== '0.0.0') lines.push(`Version: ${meta.version}`)
  lines.push('')

  // --- Stack & Architecture ---
  lines.push('## Stack & Architecture')
  lines.push('')
  lines.push(renderStack(stack).trimEnd())
  lines.push('')

  // --- Conventions ---
  lines.push('## Conventions')
  lines.push('')
  lines.push(renderConventions(conventions).trimEnd())
  lines.push('')

  // --- Recent Decisions ---
  lines.push('## Recent Decisions')
  lines.push('')
  lines.push('Context for understanding recent architectural choices:')
  lines.push('')
  lines.push(renderDecisions(decisions).trimEnd())
  lines.push('')

  // --- Active Warnings ---
  lines.push('## Active Warnings')
  lines.push('')
  lines.push('Known issues to be aware of while working on this codebase:')
  lines.push('')
  lines.push(renderDebt(debt).trimEnd())
  lines.push('')

  // --- Memory (Claude Code specific) ---
  lines.push('## Memory')
  lines.push('')
  lines.push(
    'This file is maintained by **[Mindr](https://github.com/ai-emart/mindr)**, ' +
    'which observes your commits and learns your codebase conventions automatically.',
  )
  lines.push('')
  lines.push('```')
  lines.push('# Search Mindr memory')
  lines.push('mindr search "<query>"')
  lines.push('')
  lines.push('# Refresh this file')
  lines.push('mindr generate claude-md')
  lines.push('```')
  lines.push('')

  return lines.join('\n')
}
