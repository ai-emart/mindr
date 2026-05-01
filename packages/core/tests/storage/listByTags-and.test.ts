import { describe, it, expect, afterEach } from 'vitest'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { SqliteBackend } from '../../src/storage/sqlite-backend.js'
import type { MindrConfig } from '../../src/config.js'

const TMP = '.test-tmp-and'
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

describe('SqliteBackend.listByTags — AND semantics', () => {
  it('single tag returns only matching memories', async () => {
    const b = makeBackend()
    await b.store({ content: 'decision A', tags: [{ key: 'type', value: 'decision' }] })
    await b.store({ content: 'note B', tags: [{ key: 'type', value: 'note' }] })

    const results = await b.listByTags([{ key: 'type', value: 'decision' }])
    expect(results).toHaveLength(1)
    expect(results[0]!.content).toBe('decision A')
  })

  it('two tags requires BOTH to be present (AND, not OR)', async () => {
    const b = makeBackend()
    // Only type=decision, no module tag → should NOT appear
    await b.store({
      content: 'decision without module',
      tags: [{ key: 'type', value: 'decision' }],
    })
    // Both type=decision AND module=auth → should appear
    await b.store({
      content: 'auth decision',
      tags: [{ key: 'type', value: 'decision' }, { key: 'module', value: 'auth' }],
    })
    // Only module=auth, no type tag → should NOT appear
    await b.store({
      content: 'auth note',
      tags: [{ key: 'type', value: 'note' }, { key: 'module', value: 'auth' }],
    })

    const results = await b.listByTags([
      { key: 'type', value: 'decision' },
      { key: 'module', value: 'auth' },
    ])

    expect(results).toHaveLength(1)
    expect(results[0]!.content).toBe('auth decision')
  })

  it('three-tag AND query filters correctly', async () => {
    const b = makeBackend()
    await b.store({
      content: 'full match',
      tags: [
        { key: 'type', value: 'decision' },
        { key: 'module', value: 'api' },
        { key: 'severity', value: 'high' },
      ],
    })
    await b.store({
      content: 'partial — missing severity',
      tags: [
        { key: 'type', value: 'decision' },
        { key: 'module', value: 'api' },
      ],
    })

    const results = await b.listByTags([
      { key: 'type', value: 'decision' },
      { key: 'module', value: 'api' },
      { key: 'severity', value: 'high' },
    ])

    expect(results).toHaveLength(1)
    expect(results[0]!.content).toBe('full match')
  })

  it('empty tags returns all memories', async () => {
    const b = makeBackend()
    await b.store({ content: 'alpha' })
    await b.store({ content: 'beta' })
    const results = await b.listByTags([])
    expect(results).toHaveLength(2)
  })

  it('no match returns empty array', async () => {
    const b = makeBackend()
    await b.store({ content: 'only decision', tags: [{ key: 'type', value: 'decision' }] })

    const results = await b.listByTags([
      { key: 'type', value: 'decision' },
      { key: 'module', value: 'nonexistent' },
    ])
    expect(results).toHaveLength(0)
  })

  it('soft-deleted memories are excluded from multi-tag results', async () => {
    const b = makeBackend()
    const m = await b.store({
      content: 'to delete',
      tags: [{ key: 'type', value: 'decision' }, { key: 'module', value: 'auth' }],
    })
    await b.forget(m.id)

    const results = await b.listByTags([
      { key: 'type', value: 'decision' },
      { key: 'module', value: 'auth' },
    ])
    expect(results).toHaveLength(0)
  })
})
