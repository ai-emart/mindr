export type DebtSeverity = 'low' | 'medium' | 'high'

export interface DebtMarker {
  id: string
  file: string
  line: number
  marker: string
  text: string
  severity: DebtSeverity
}

export const DEFAULT_DEBT_MARKERS = ['TODO', 'FIXME', 'HACK', 'XXX', 'TECH-DEBT'] as const

export function inferDebtSeverity(marker: string, text: string): DebtSeverity {
  if (/\b(urgent|asap|prod|production)\b/i.test(text)) return 'high'
  const upper = marker.toUpperCase()
  if (upper === 'HACK' || upper === 'FIXME' || upper === 'XXX') return 'high'
  if (upper === 'TODO' || upper === 'TECH-DEBT') return 'medium'
  return 'low'
}

export function stableDebtId(file: string, marker: string, text: string): string {
  const normalized = `${file}:${marker}:${text.replace(/\s+/g, ' ').trim()}`
  let hash = 0
  for (let i = 0; i < normalized.length; i++) {
    hash = (hash * 31 + normalized.charCodeAt(i)) >>> 0
  }
  return `debt-${hash.toString(16).padStart(8, '0')}`
}

export function detectDebtInText(
  file: string,
  text: string,
  markers: readonly string[] = DEFAULT_DEBT_MARKERS,
): DebtMarker[] {
  const escaped = markers.map((m) => m.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')
  const pattern = new RegExp(`\\b(${escaped})\\b[:\\s-]*(.*)$`, 'i')
  const results: DebtMarker[] = []
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i++) {
    const match = pattern.exec(lines[i] ?? '')
    if (!match) continue
    const marker = match[1]!.toUpperCase()
    const comment = (match[2] ?? '').trim()
    results.push({
      id: stableDebtId(file, marker, comment),
      file,
      line: i + 1,
      marker,
      text: comment,
      severity: inferDebtSeverity(marker, comment),
    })
  }
  return results
}

export interface DebtDiffFinding extends DebtMarker {
  removed: boolean
}

export function detectDebtInUnifiedDiff(
  diff: string,
  markers: readonly string[] = DEFAULT_DEBT_MARKERS,
): DebtDiffFinding[] {
  const findings: DebtDiffFinding[] = []
  let currentFile = ''
  let addedLine = 0
  let removedLine = 0

  for (const raw of diff.split('\n')) {
    if (raw.startsWith('+++ b/')) {
      currentFile = raw.slice(6)
    } else if (raw.startsWith('@@ ')) {
      const added = raw.match(/\+(\d+)/)
      const removed = raw.match(/-(\d+)/)
      addedLine = added ? Number.parseInt(added[1]!, 10) : 0
      removedLine = removed ? Number.parseInt(removed[1]!, 10) : 0
    } else if ((raw.startsWith('+') || raw.startsWith('-')) && !raw.startsWith('+++') && !raw.startsWith('---')) {
      const removed = raw.startsWith('-')
      const lineNo = removed ? removedLine : addedLine
      const detected = detectDebtInText(currentFile, raw.slice(1), markers)
      for (const item of detected) findings.push({ ...item, line: lineNo, removed })
      if (removed) removedLine++
      else addedLine++
    } else if (!raw.startsWith('\\')) {
      addedLine++
      removedLine++
    }
  }

  return findings
}
