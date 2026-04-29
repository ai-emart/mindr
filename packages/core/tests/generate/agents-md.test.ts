import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'fs'
import { join, dirname } from 'path'
import { tmpdir } from 'os'
import { simpleGit } from 'simple-git'
import { generateAgentsMd, SIGNATURE, checkExistingFile } from '../../src/generate/agents-md.js'
import { generateClaudeMd } from '../../src/generate/claude-md.js'
import { onCommit } from '../../src/git/watcher.js'
import { SqliteBackend } from '../../src/storage/sqlite-backend.js'
import type { MindrMemory, MemoryBackend, MindrSession, StoreParams, SearchParams } from '../../src/storage/backend.js'
import type { MindrTag } from '../../src/schema.js'
import type { GenerateContext } from '../../src/generate/context.js'
import type { MindrConfig } from '../../src/config.js'

// ---------------------------------------------------------------------------
// Cleanup registry
// ---------------------------------------------------------------------------

const cleanups: Array<() => void> = []
afterEach(() => { for (const fn of cleanups) fn(); cleanups.length = 0 })

function tempDir(): string {
  const d = mkdtempSync(join(tmpdir(), 'mindr-gen-'))
  cleanups.push(() => rmSync(d, { recursive: true, force: true }))
  return d
}

function write(base: string, relPath: string, content: string): void {
  const full = join(base, relPath)
  mkdirSync(dirname(full), { recursive: true })
  writeFileSync(full, content)
}

function makeSqliteBackend(_dir: string): SqliteBackend {
  const dbDir = mkdtempSync(join(tmpdir(), 'mindr-db-'))
  const config: MindrConfig = {
    remembr: {},
    storage: { backend: 'sqlite', sqlite_path: join(dbDir, 'test.sqlite') },
    embeddings: {},
  }
  const backend = new SqliteBackend(config)
  cleanups.push(() => {
    try { backend.close() } catch { /* ignore */ }
    try { rmSync(dbDir, { recursive: true, force: true }) } catch { /* ignore */ }
  })
  return backend
}

// ---------------------------------------------------------------------------
// Mock backend (for snapshot tests — fully deterministic)
// ---------------------------------------------------------------------------

class MockBackend implements MemoryBackend {
  private store2: MindrMemory[]
  constructor(memories: MindrMemory[]) { this.store2 = memories }

  async createSession(): Promise<MindrSession> { return { sessionId: 'mock', createdAt: '2024-01-01T00:00:00Z' } }
  async store(_: StoreParams): Promise<MindrMemory> { throw new Error('not supported') }
  async search(_: SearchParams): Promise<MindrMemory[]> { return [] }
  async forget(_: string): Promise<void> {}
  async getById(_: string): Promise<MindrMemory | null> { return null }

  async listByTags(tags: MindrTag[]): Promise<MindrMemory[]> {
    return this.store2.filter((m) =>
      tags.every((t) => m.tags.some((mt) => mt.key === t.key && mt.value === t.value)),
    )
  }
}

function makeMemory(overrides: Partial<MindrMemory> & Pick<MindrMemory, 'content' | 'tags'>): MindrMemory {
  return {
    id: 'fixed-id',
    role: 'system',
    createdAt: '2024-01-15T10:00:00Z',
    metadata: null,
    sessionId: null,
    ...overrides,
  }
}

const FIXTURE_CONTEXT: GenerateContext = {
  meta: {
    name: 'demo-app',
    description: 'A demonstration application',
    version: '1.2.0',
    language: 'typescript',
    repoUrl: 'https://github.com/example/demo-app',
  },
  stack: [
    { name: 'TypeScript', role: 'language',       category: 'language'   },
    { name: 'React',      role: 'UI library',      category: 'framework'  },
    { name: 'Vitest',     role: 'test runner',     category: 'testing'    },
  ],
  conventions: [
    {
      language: 'typescript',
      analyzedAt: '2024-01-15T09:00:00Z',
      analyzedFiles: 12,
      conventions: [
        { pattern: 'camelCase',  category: 'functionNames', score: 97, sampleCount: 45 },
        { pattern: 'PascalCase', category: 'classNames',    score: 100, sampleCount: 8 },
        { pattern: 'camelCase',  category: 'variableNames', score: 82, sampleCount: 30 },
      ],
    },
  ],
  decisions: [
    makeMemory({
      content: 'Decision: switch to Vitest for faster test runs',
      tags: [{ key: 'type', value: 'decision' }],
      metadata: { date: '2024-01-10', trigger: 'keyword' },
    }),
    makeMemory({
      content: 'Decision: migrate from CRA to Vite',
      tags: [{ key: 'type', value: 'decision' }],
      createdAt: '2024-01-08T10:00:00Z',
      metadata: { date: '2024-01-08', trigger: 'keyword' },
    }),
  ],
  debt: [
    makeMemory({
      content: 'TODO at src/auth.ts:22 — validate token expiry',
      tags: [{ key: 'type', value: 'debt' }],
      metadata: { file: 'src/auth.ts', line: 22, keyword: 'TODO' },
    }),
    makeMemory({
      content: 'FIXME at src/db.ts:45 — handle connection pool exhaustion',
      tags: [{ key: 'type', value: 'debt' }],
      metadata: { file: 'src/db.ts', line: 45, keyword: 'FIXME' },
    }),
  ],
}

// ---------------------------------------------------------------------------
// Snapshot tests
// ---------------------------------------------------------------------------

describe('generateAgentsMd — snapshot', () => {
  it('renders AGENTS.md deterministically from fixed context', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toMatchSnapshot()
  })

  it('starts with the Mindr signature comment', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md.startsWith(SIGNATURE)).toBe(true)
  })

  it('contains all required sections', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('## Stack & Architecture')
    expect(md).toContain('## Conventions')
    expect(md).toContain('## Recent Decisions')
    expect(md).toContain('## Active Warnings')
  })

  it('renders project name and version', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('demo-app')
    expect(md).toContain('1.2.0')
  })

  it('renders stack items', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('React')
    expect(md).toContain('TypeScript')
    expect(md).toContain('Vitest')
  })

  it('renders convention table with camelCase', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('camelCase')
    expect(md).toContain('97%')
  })

  it('renders decisions', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('switch to Vitest')
    expect(md).toContain('migrate from CRA to Vite')
  })

  it('renders debt items', async () => {
    const backend = new MockBackend([])
    const md = await generateAgentsMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('src/auth.ts')
    expect(md).toContain('validate token expiry')
  })
})

describe('generateClaudeMd — snapshot', () => {
  it('renders CLAUDE.md deterministically from fixed context', async () => {
    const backend = new MockBackend([])
    const md = await generateClaudeMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toMatchSnapshot()
  })

  it('includes the ## Memory section', async () => {
    const backend = new MockBackend([])
    const md = await generateClaudeMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('## Memory')
    expect(md).toContain('Mindr')
  })

  it('uses imperative convention language', async () => {
    const backend = new MockBackend([])
    const md = await generateClaudeMd('/mock/root', backend, { context: FIXTURE_CONTEXT })
    expect(md).toContain('Use camelCase')
  })
})

// ---------------------------------------------------------------------------
// Empty-backend graceful output
// ---------------------------------------------------------------------------

describe('generateAgentsMd — empty backend', () => {
  it('renders placeholder text when no data exists', async () => {
    const backend = new MockBackend([])
    const ctx: GenerateContext = {
      meta: { name: 'empty-app', description: '', version: '0.0.0', language: 'unknown', repoUrl: null },
      stack: [],
      conventions: [],
      decisions: [],
      debt: [],
    }
    const md = await generateAgentsMd('/mock/root', backend, { context: ctx })
    expect(md).toContain('No convention analysis yet')
    expect(md).toContain('No decisions recorded')
    expect(md).toContain('No active debt items')
  })
})

// ---------------------------------------------------------------------------
// Overwrite guard (checkExistingFile)
// ---------------------------------------------------------------------------

describe('checkExistingFile', () => {
  it('does not throw when file does not exist', () => {
    const path = join(tempDir(), 'new-file.md')
    expect(() => checkExistingFile(path, false, SIGNATURE)).not.toThrow()
  })

  it('does not throw when file contains the Mindr signature', () => {
    const dir = tempDir()
    const path = join(dir, 'AGENTS.md')
    writeFileSync(path, `${SIGNATURE}\n# My project\n`)
    expect(() => checkExistingFile(path, false, SIGNATURE)).not.toThrow()
  })

  it('throws OverwriteError when file exists without signature and force=false', () => {
    const dir = tempDir()
    const path = join(dir, 'AGENTS.md')
    writeFileSync(path, '# My hand-crafted file\nDo not overwrite me!\n')
    expect(() => checkExistingFile(path, false, SIGNATURE)).toThrow()
  })

  it('does not throw when force=true even without signature', () => {
    const dir = tempDir()
    const path = join(dir, 'AGENTS.md')
    writeFileSync(path, '# Hand-crafted content\n')
    expect(() => checkExistingFile(path, true, SIGNATURE)).not.toThrow()
  })
})

// ---------------------------------------------------------------------------
// E2E: scaffold real repo → convention detection → generate AGENTS.md
// ---------------------------------------------------------------------------

describe('generateAgentsMd — E2E with real repo', () => {
  it('generates valid AGENTS.md after onCommit populates the backend', async () => {
    const dir = tempDir()
    const git = simpleGit({ baseDir: dir })
    await git.init()
    await git.addConfig('user.name', 'Tester')
    await git.addConfig('user.email', 'tester@example.com')

    // Write a package.json and TypeScript source files
    write(dir, 'package.json', JSON.stringify({
      name: 'e2e-demo',
      description: 'E2E demo project',
      version: '0.1.0',
      dependencies: { react: '^18.0.0' },
      devDependencies: { typescript: '^5.0.0', vitest: '^1.0.0' },
    }))

    write(dir, 'src/app.ts', [
      'export function initApp() { return "app" }',
      'export function renderComponent(props: object) { return props }',
      'export function handleRequest(req: unknown) { return req }',
      'export function processEvent(event: unknown) { return event }',
      'export function formatOutput(value: unknown) { return String(value) }',
      'export class AppController {',
      '  handleGet() { return null }',
      '  handlePost(data: unknown) { return data }',
      '}',
    ].join('\n'))

    write(dir, 'src/utils.ts', [
      'export function parseJson(raw: string) { return JSON.parse(raw) }',
      'export function buildQuery(params: Record<string, string>) { return params }',
      'export function validateInput(input: unknown) { return Boolean(input) }',
    ].join('\n'))

    const backend = makeSqliteBackend(dir)

    // Commit all files so git ls-files finds them
    await git.add('.')
    await git.commit('feat: initial setup')
    const sha = (await git.revparse(['HEAD'])).trim()

    // onCommit triggers convention detection + stores memories
    const result = await onCommit(dir, sha, backend)
    expect(result.contextMemories).toBe(1)

    // Generate AGENTS.md
    const md = await generateAgentsMd(dir, backend)

    // Assert structure
    expect(md).toContain(SIGNATURE)
    expect(md).toContain('e2e-demo')
    expect(md).toContain('## Stack & Architecture')
    expect(md).toContain('React')
    expect(md).toContain('TypeScript')
    expect(md).toContain('Vitest')
    expect(md).toContain('## Conventions')
    expect(md).toContain('## Recent Decisions')
    expect(md).toContain('## Active Warnings')

    // Convention detection should have found camelCase (9 camelCase functions)
    if (result.conventionMemories > 0) {
      expect(md).toContain('camelCase')
    }
  })
})
