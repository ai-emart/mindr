import { RemembrClient } from '@remembr/sdk'
import type { Episode, SearchResult } from '@remembr/sdk'
import type { MindrConfig } from '../config.js'
import { tagsToStrings, tagsFromStrings } from '../schema.js'
import type { MindrTag } from '../schema.js'
import type { MemoryBackend, MindrMemory, MindrSession, StoreParams, SearchParams } from './backend.js'

function episodeToMemory(e: Episode): MindrMemory {
  return {
    id: e.episode_id,
    sessionId: e.session_id ?? null,
    role: e.role,
    content: e.content,
    tags: tagsFromStrings(e.tags),
    metadata: e.metadata ?? null,
    createdAt: e.created_at,
  }
}

function searchResultToMemory(r: SearchResult): MindrMemory {
  return {
    id: r.episode_id,
    sessionId: null,
    role: r.role,
    content: r.content,
    tags: tagsFromStrings(r.tags),
    metadata: null,
    createdAt: r.created_at,
  }
}

export class RemembrBackend implements MemoryBackend {
  private readonly client: RemembrClient

  constructor(config: MindrConfig) {
    this.client = new RemembrClient({
      apiKey: config.remembr.api_key ?? process.env['REMEMBR_API_KEY'],
      baseUrl: config.remembr.base_url,
    })
  }

  async createSession(metadata?: Record<string, unknown>): Promise<MindrSession> {
    const s = await this.client.createSession(metadata)
    return {
      sessionId: s.session_id,
      metadata: s.metadata ?? null,
      createdAt: s.created_at,
    }
  }

  async store(params: StoreParams): Promise<MindrMemory> {
    const ep = await this.client.store({
      content: params.content,
      role: params.role,
      sessionId: params.sessionId,
      tags: params.tags ? tagsToStrings(params.tags) : undefined,
      metadata: params.metadata,
    })
    return episodeToMemory(ep)
  }

  async search(params: SearchParams): Promise<MindrMemory[]> {
    const res = await this.client.search({
      query: params.query,
      sessionId: params.sessionId,
      tags: params.tags ? tagsToStrings(params.tags) : undefined,
      limit: params.limit,
      fromTime: params.fromTime,
      toTime: params.toTime,
      searchMode: 'hybrid',
    })
    return res.results.map(searchResultToMemory)
  }

  async forget(memoryId: string): Promise<void> {
    await this.client.forgetEpisode(memoryId)
  }

  async listByTags(tags: MindrTag[], limit = 50): Promise<MindrMemory[]> {
    const res = await this.client.search({
      query: '',
      tags: tagsToStrings(tags),
      limit,
      searchMode: 'keyword',
    })
    return res.results.map(searchResultToMemory)
  }

  // Remembr has no single-episode fetch endpoint; callers should use store() return value.
  async getById(_memoryId: string): Promise<MindrMemory | null> {
    return null
  }
}
