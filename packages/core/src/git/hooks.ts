import { readFileSync, writeFileSync, existsSync, chmodSync } from 'fs'
import { join } from 'path'
import { platform } from 'process'

const HOOK_BEGIN = '# >>> mindr-begin <<<'
const HOOK_END = '# >>> mindr-end <<<'
const HOOK_BODY = 'mindr internal on-commit "$(git rev-parse HEAD)"'

const MINDR_BLOCK = `${HOOK_BEGIN}\n${HOOK_BODY}\n${HOOK_END}`

function hookPath(repoRoot: string): string {
  return join(repoRoot, '.git', 'hooks', 'post-commit')
}

export function installPostCommitHook(repoRoot: string): void {
  const path = hookPath(repoRoot)
  let existing = ''

  if (existsSync(path)) {
    existing = readFileSync(path, 'utf8')
    // Already installed — do nothing.
    if (existing.includes(HOOK_BEGIN)) return
  }

  let content: string
  if (existing) {
    // Append the mindr block after existing content, preserving it.
    content = existing.trimEnd() + '\n' + MINDR_BLOCK + '\n'
  } else {
    content = '#!/bin/sh\n' + MINDR_BLOCK + '\n'
  }

  // Always write LF endings.
  writeFileSync(path, content.replace(/\r\n/g, '\n'), { encoding: 'utf8' })

  if (platform !== 'win32') {
    chmodSync(path, 0o755)
  }
}

export function uninstallPostCommitHook(repoRoot: string): void {
  const path = hookPath(repoRoot)
  if (!existsSync(path)) return

  const content = readFileSync(path, 'utf8')
  if (!content.includes(HOOK_BEGIN)) return

  // Remove the mindr block (begin marker through end marker, inclusive).
  const lines = content.split('\n')
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    if (line === HOOK_BEGIN) {
      inside = true
      continue
    }
    if (line === HOOK_END) {
      inside = false
      continue
    }
    if (!inside) out.push(line)
  }

  const result = out.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n'
  writeFileSync(path, result, { encoding: 'utf8' })
}
