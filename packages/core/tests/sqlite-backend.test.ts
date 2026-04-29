import { describe, it, expect, afterEach } from 'vitest'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { SqliteBackend } from '../src/storage/sqlite-backend.js'
import type { MindrConfig } from '../src/config.js'

const TMP = '.test-tmp'
const openBackends: SqliteBackend[] = []

function makeBackend(): SqliteBackend {
  const config: MindrConfig = {
    remembr: {},
    storage: { backend: 'sqlite', sqlite_path: `${TMP}/${randomUUID()}.sqlite` },
    embeddings: {},
  }
  const backend = new SqliteBackend(config)
  openBackends.push(backend)
  return backend
}

afterEach(() => {
  for (const b of openBackends) {
    try {
      b.close()
    } catch {
      // ignore
    }
  }
  openBackends.length = 0
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {
    // cleanup is best-effort
  }
})

describe('SqliteBackend', () => {
  it('stores and retrieves a memory by id', async () => {
    const backend = makeBackend()
    const stored = await backend.store({ content: 'remember this', role: 'user' })
    expect(stored.id).toBeTruthy()
    expect(stored.content).toBe('remember this')
    const found = await backend.getById(stored.id)
    expect(found?.content).toBe('remember this')
  })

  it('searches memories by keyword', async () => {
    const backend = makeBackend()
    await backend.store({ content: 'TypeScript is great for large codebases', role: 'user' })
    await backend.store({ content: 'Python is used for data science', role: 'user' })
    const results = await backend.search({ query: 'TypeScript' })
    expect(results.length).toBe(1)
    expect(results[0].content).toContain('TypeScript')
  })

  it('soft-deletes a memory', async () => {
    const backend = makeBackend()
    const stored = await backend.store({ content: 'to be forgotten', role: 'user' })
    await backend.forget(stored.id)
    expect(await backend.getById(stored.id)).toBeNull()
  })

  it('excludes deleted memories from search', async () => {
    const backend = makeBackend()
    const stored = await backend.store({ content: 'forgettable content here', role: 'user' })
    await backend.forget(stored.id)
    const results = await backend.search({ query: 'forgettable' })
    expect(results).toHaveLength(0)
  })

  it('lists memories by tag', async () => {
    const backend = makeBackend()
    await backend.store({ content: 'decision memory', tags: [{ key: 'type', value: 'decision' }] })
    await backend.store({ content: 'note memory', tags: [{ key: 'type', value: 'note' }] })
    const results = await backend.listByTags([{ key: 'type', value: 'decision' }])
    expect(results).toHaveLength(1)
    expect(results[0].content).toBe('decision memory')
  })

  it('listByTags with empty tags returns all memories', async () => {
    const backend = makeBackend()
    await backend.store({ content: 'alpha' })
    await backend.store({ content: 'beta' })
    const results = await backend.listByTags([])
    expect(results.length).toBe(2)
  })

  it('creates a session and returns it', async () => {
    const backend = makeBackend()
    const session = await backend.createSession({ project: 'test' })
    expect(session.sessionId).toBeTruthy()
    expect(session.metadata).toEqual({ project: 'test' })
    expect(session.createdAt).toBeTruthy()
  })

  it('round-trips tags through store/retrieve', async () => {
    const backend = makeBackend()
    const tags = [
      { key: 'type', value: 'convention' },
      { key: 'module', value: 'auth' },
    ]
    const stored = await backend.store({ content: 'use JWT', tags })
    const found = await backend.getById(stored.id)
    expect(found?.tags).toEqual(tags)
  })
})
