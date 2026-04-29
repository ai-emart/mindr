export interface SessionActivity {
  sessionId?: string
  filesTouched: string[]
  modulesTouched: string[]
  activeTaskFiles?: string[]
  startedAt?: string | Date
  now?: string | Date
  topicSpread?: number
}

export type ContextHealthRecommendation = 'ok' | 'consider_checkpoint' | 'recommend_fresh_session'

export interface ContextHealthResult {
  score: number
  recommendation: ContextHealthRecommendation
  breakdown: {
    modulePenalty: number
    filePenalty: number
    offTaskPenalty: number
    timePenalty: number
    topicPenalty: number
  }
}

function uniqueCount(values: string[]): number {
  return new Set(values.filter(Boolean)).size
}

/**
 * Scores session focus from 0-100.
 *
 * The score starts at 100 and subtracts deterministic penalties:
 * - Modules: the first two modules are free; each extra module costs 8 points,
 *   capped at 24. Crossing many modules usually means the conversation is
 *   carrying unrelated architecture state.
 * - Files: the first eight files are free; each extra file costs 2 points,
 *   capped at 20. A session can touch several files without being polluted,
 *   but broad file spread increases context load.
 * - Off-task files: if `activeTaskFiles` is supplied, we compute the ratio of
 *   touched files not in the active task. That ratio costs up to 25 points.
 * - Time: after 90 minutes, each extra started hour costs 5 points, capped at
 *   15. Long-running sessions accumulate stale assumptions.
 * - Topic spread: optional caller-provided 0-1 measure, worth up to 16 points.
 *
 * Recommendations are simple thresholds: >=70 ok, 40-69 checkpoint, <40 fresh
 * session. Mindr warns only; the agent decides what to do.
 */
export function scoreContextHealth(session: SessionActivity): ContextHealthResult {
  const modules = uniqueCount(session.modulesTouched)
  const files = uniqueCount(session.filesTouched)
  const modulePenalty = Math.min(24, Math.max(0, modules - 2) * 8)
  const filePenalty = Math.min(20, Math.max(0, files - 8) * 2)

  const taskFiles = new Set(session.activeTaskFiles ?? [])
  const offTaskCount = taskFiles.size === 0
    ? 0
    : session.filesTouched.filter((file) => !taskFiles.has(file)).length
  const offTaskRatio = files === 0 ? 0 : offTaskCount / files
  const offTaskPenalty = Math.round(Math.min(25, offTaskRatio * 25))

  const start = session.startedAt ? new Date(session.startedAt).getTime() : undefined
  const now = session.now ? new Date(session.now).getTime() : Date.now()
  const elapsedMinutes = start ? Math.max(0, (now - start) / 60000) : 0
  const timePenalty = Math.min(15, Math.max(0, Math.floor((elapsedMinutes - 90) / 60) * 5))

  const topicPenalty = Math.round(Math.min(16, Math.max(0, session.topicSpread ?? 0) * 16))
  const score = Math.max(0, Math.min(100, 100 - modulePenalty - filePenalty - offTaskPenalty - timePenalty - topicPenalty))
  const recommendation: ContextHealthRecommendation =
    score < 40 ? 'recommend_fresh_session' : score < 70 ? 'consider_checkpoint' : 'ok'

  return { score, recommendation, breakdown: { modulePenalty, filePenalty, offTaskPenalty, timePenalty, topicPenalty } }
}
