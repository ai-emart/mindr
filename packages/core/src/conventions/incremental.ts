// Incremental convention update: re-analyses only languages affected by changed files.

import { extname } from 'path'
import { LANGUAGE_SPECS } from './languages.js'
import { detect, type ConventionProfile, type DetectOptions } from './detector.js'

export async function updateForChangedFiles(
  repoRoot: string,
  existing: Map<string, ConventionProfile>,
  changedPaths: string[],
  options: DetectOptions = {},
): Promise<Map<string, ConventionProfile>> {
  // Determine which languages are affected
  const extToLang = new Map<string, string>()
  for (const spec of LANGUAGE_SPECS) {
    for (const ext of spec.extensions) {
      extToLang.set(ext, spec.name)
    }
  }

  const affected = new Set<string>()
  for (const p of changedPaths) {
    const lang = extToLang.get(extname(p))
    if (lang) affected.add(lang)
  }

  if (affected.size === 0) return existing

  // Re-run full detect (scans all files for affected languages)
  const fresh = await detect(repoRoot, options)

  const result = new Map(existing)
  for (const profile of fresh) {
    if (affected.has(profile.language)) {
      result.set(profile.language, profile)
    }
  }
  return result
}
