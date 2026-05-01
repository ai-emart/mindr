import { describe, it, expect, afterEach } from 'vitest'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { SqliteBackend } from '../../src/storage/sqlite-backend.js'
import { functionFingerprints } from '../../src/bugs/fingerprint.js'
import { checkForBugPatterns } from '../../src/bugs/match.js'
import type { MindrConfig } from '../../src/config.js'

const TMP = '.test-tmp-bugs-e2e'
const backends: SqliteBackend[] = []

function makeBackend(): SqliteBackend {
  const config: MindrConfig = {
    remembr: {},
    storage: { backend: 'sqlite', sqlite_path: `${TMP}/${randomUUID()}.sqlite` },
    embeddings: {},
  }
  const b = new SqliteBackend(config)
  backends.push(b)
  return b
}

afterEach(() => {
  for (const b of backends) { try { b.close() } catch { /**/ } }
  backends.length = 0
  try { rmSync(TMP, { recursive: true, force: true }) } catch { /**/ }
})

// The same JS function that historically had a bug (null-check missing)
const BUGGY_CODE = `
function processResult(result) {
  return result.value * 2;
}
`

// The fixed version — structurally different (has an if-check)
const FIXED_CODE = `
function processResult(result) {
  if (!result) return 0;
  return result.value * 2;
}
`

describe('Bug pattern memory — end-to-end', () => {
  it('stores a bug fingerprint and detects the same pattern later', async () => {
    const backend = makeBackend()

    // 1. Compute the fingerprint of the buggy code (as the watcher would on a fix commit)
    const fps = functionFingerprints(BUGGY_CODE, 'javascript')
    expect(fps.length).toBeGreaterThan(0)
    const fp = fps[0]!

    // 2. Store the bug pattern memory (simulating what git/watcher.ts does on a fix commit)
    await backend.store({
      content: 'Bug fix: null check missing in processResult',
      role: 'user',
      tags: [
        { key: 'type',        value: 'bug_pattern' },
        { key: 'language',    value: 'javascript' },
        { key: 'fingerprint', value: fp.hash },
        { key: 'fix_commit',  value: 'abc123' },
      ],
      metadata: { language: 'javascript', fingerprint: fp.hash },
    })

    // 3. Later: agent generates structurally identical code — should trigger a warning
    const check = await checkForBugPatterns(backend, BUGGY_CODE, 'javascript')

    expect(check.matches.length).toBeGreaterThan(0)
    expect(check.confidence).toBeGreaterThan(0)
    expect(check.matches[0]!.fingerprint).toBe(fp.hash)
    expect(check.matches[0]!.memory.content).toContain('null check missing')
  })

  it('does NOT match structurally different code', async () => {
    const backend = makeBackend()

    // Store fingerprint of BUGGY_CODE
    const fps = functionFingerprints(BUGGY_CODE, 'javascript')
    const fp = fps[0]!
    await backend.store({
      content: 'Bug fix: null check missing in processResult',
      role: 'user',
      tags: [
        { key: 'type',        value: 'bug_pattern' },
        { key: 'language',    value: 'javascript' },
        { key: 'fingerprint', value: fp.hash },
      ],
    })

    // Check FIXED_CODE (structurally different — has the if-check) → no match
    const check = await checkForBugPatterns(backend, FIXED_CODE, 'javascript')
    expect(check.matches).toHaveLength(0)
    expect(check.confidence).toBe(0)
  })

  it('does NOT cross-contaminate languages', async () => {
    const backend = makeBackend()

    // Store a JS fingerprint
    const fps = functionFingerprints(BUGGY_CODE, 'javascript')
    const fp = fps[0]!
    await backend.store({
      content: 'JS bug pattern',
      role: 'user',
      tags: [
        { key: 'type',        value: 'bug_pattern' },
        { key: 'language',    value: 'javascript' },
        { key: 'fingerprint', value: fp.hash },
      ],
    })

    // Checking the same code but asking for TypeScript — should NOT match
    // (language tag mismatch means AND query finds nothing)
    const check = await checkForBugPatterns(backend, BUGGY_CODE, 'typescript')
    expect(check.matches).toHaveLength(0)
  })

  it('returns zero results when no bug patterns are stored', async () => {
    const backend = makeBackend()
    const check = await checkForBugPatterns(backend, BUGGY_CODE, 'javascript')
    expect(check.matches).toHaveLength(0)
    expect(check.hits).toBe(0)
  })
})
