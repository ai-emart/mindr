import { describe, it, expect, vi, afterAll } from 'vitest'
import { rmSync } from 'fs'
import { randomUUID } from 'crypto'
import { getBackend } from '../src/storage/factory.js'
import type { MindrConfig } from '../src/config.js'
import { SqliteBackend } from '../src/storage/sqlite-backend.js'
import { RemembrBackend } from '../src/storage/remembr-backend.js'

vi.mock('@remembr/sdk', () => ({
  RemembrClient: vi.fn().mockImplementation(() => ({
    store: vi.fn(),
    search: vi.fn(),
    forgetEpisode: vi.fn(),
    createSession: vi.fn(),
  })),
}))

const TMP = `.test-tmp-factory-${randomUUID()}`

afterAll(() => {
  try {
    rmSync(TMP, { recursive: true, force: true })
  } catch {
    // cleanup is best-effort
  }
})

describe('getBackend', () => {
  it('returns SqliteBackend when backend is sqlite', () => {
    const config: MindrConfig = {
      remembr: {},
      storage: { backend: 'sqlite', sqlite_path: `${TMP}/factory.sqlite` },
      embeddings: {},
    }
    const backend = getBackend(config)
    expect(backend).toBeInstanceOf(SqliteBackend)
    ;(backend as SqliteBackend).close()
  })

  it('returns RemembrBackend when backend is remembr', () => {
    const config: MindrConfig = {
      remembr: { api_key: 'key' },
      storage: { backend: 'remembr', sqlite_path: '.mindr/mindr.sqlite' },
      embeddings: {},
    }
    const backend = getBackend(config)
    expect(backend).toBeInstanceOf(RemembrBackend)
  })
})
