import type { MindrMemory } from '../storage/backend.js'

export interface QualityStats {
  retrievalCount?: number
  contradicted?: boolean
  now?: Date
}

export interface QualityBreakdown {
  recency: number
  commitAssociation: number
  manualCapture: number
  retrievalFrequency: number
  contradictionPenalty: number
  total: number
}

function hasTag(memory: MindrMemory, key: string, value?: string): boolean {
  return memory.tags.some((tag) => tag.key === key && (value == null || tag.value === value))
}

export function scoreMemoryQuality(memory: MindrMemory, stats: QualityStats = {}): QualityBreakdown {
  const now = stats.now ?? new Date()
  const ageDays = Math.max(0, (now.getTime() - new Date(memory.createdAt).getTime()) / 86400000)
  const recency = ageDays <= 7 ? 30 : Math.round(30 * Math.pow(0.5, (ageDays - 7) / 30))
  const commitAssociation = hasTag(memory, 'git_commit') ? 25 : 0
  const manualCapture = hasTag(memory, 'source', 'manual') ? 20 : 0
  const retrievalFrequency = Math.min(15, Math.round(Math.log2((stats.retrievalCount ?? 0) + 1) * 5))
  const contradictionPenalty = stats.contradicted || hasTag(memory, 'contradicted', 'true') ? -10 : 0
  const total = Math.max(0, Math.min(100, recency + commitAssociation + manualCapture + retrievalFrequency + contradictionPenalty))
  return { recency, commitAssociation, manualCapture, retrievalFrequency, contradictionPenalty, total }
}
