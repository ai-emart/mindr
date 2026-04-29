import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Episode, MemoryQueryResult } from '@remembr/sdk'

const { mockStore, mockSearch, mockForgetEpisode, mockCreateSession } = vi.hoisted(() => ({
  mockStore: vi.fn(),
  mockSearch: vi.fn(),
  mockForgetEpisode: vi.fn(),
  mockCreateSession: vi.fn(),
}))

vi.mock('@remembr/sdk', () => ({
  RemembrClient: vi.fn().mockImplementation(() => ({
    store: mockStore,
    search: mockSearch,
    forgetEpisode: mockForgetEpisode,
    createSession: mockCreateSession,
  })),
}))

import { RemembrBackend } from '../src/storage/remembr-backend.js'
import type { MindrConfig } from '../src/config.js'

const config: MindrConfig = {
  remembr: { api_key: 'test-key' },
  storage: { backend: 'remembr', sqlite_path: '.mindr/mindr.sqlite' },
  embeddings: {},
}

const isoNow = new Date().toISOString()

describe('RemembrBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('translates MindrTag[] to mindr: strings when storing', async () => {
    const ep: Episode = {
      episode_id: 'ep-1',
      content: 'hello world',
      role: 'user',
      created_at: isoNow,
      tags: ['mindr:type:note', 'mindr:module:core'],
      session_id: null,
    }
    mockStore.mockResolvedValue(ep)

    const backend = new RemembrBackend(config)
    const result = await backend.store({
      content: 'hello world',
      tags: [
        { key: 'type', value: 'note' },
        { key: 'module', value: 'core' },
      ],
    })

    expect(mockStore).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['mindr:type:note', 'mindr:module:core'] }),
    )
    expect(result.tags).toEqual([
      { key: 'type', value: 'note' },
      { key: 'module', value: 'core' },
    ])
  })

  it('parses mindr: tags from search results and ignores foreign tags', async () => {
    const queryResult: MemoryQueryResult = {
      request_id: 'r1',
      results: [
        {
          episode_id: 'ep-2',
          content: 'search result',
          role: 'assistant',
          score: 0.9,
          created_at: isoNow,
          tags: ['mindr:type:decision', 'other:ignored'],
        },
      ],
      total: 1,
      query_time_ms: 5,
    }
    mockSearch.mockResolvedValue(queryResult)

    const backend = new RemembrBackend(config)
    const results = await backend.search({ query: 'test' })

    expect(results).toHaveLength(1)
    expect(results[0].tags).toEqual([{ key: 'type', value: 'decision' }])
  })

  it('calls forgetEpisode with the correct memory id', async () => {
    mockForgetEpisode.mockResolvedValue({ deleted: true })
    const backend = new RemembrBackend(config)
    await backend.forget('ep-123')
    expect(mockForgetEpisode).toHaveBeenCalledWith('ep-123')
  })

  it('translates tags when listing by tag', async () => {
    mockSearch.mockResolvedValue({ request_id: 'r2', results: [], total: 0, query_time_ms: 1 })
    const backend = new RemembrBackend(config)
    await backend.listByTags([{ key: 'type', value: 'debt' }], 10)
    expect(mockSearch).toHaveBeenCalledWith(
      expect.objectContaining({ tags: ['mindr:type:debt'], limit: 10 }),
    )
  })

  it('maps Episode fields to MindrMemory fields', async () => {
    const ep: Episode = {
      episode_id: 'ep-3',
      content: 'some content',
      role: 'assistant',
      created_at: isoNow,
      tags: [],
      session_id: 'sess-1',
      metadata: { source: 'cli' },
    }
    mockStore.mockResolvedValue(ep)

    const backend = new RemembrBackend(config)
    const result = await backend.store({ content: 'some content', role: 'assistant' })

    expect(result.id).toBe('ep-3')
    expect(result.sessionId).toBe('sess-1')
    expect(result.metadata).toEqual({ source: 'cli' })
    expect(result.createdAt).toBe(isoNow)
  })
})
