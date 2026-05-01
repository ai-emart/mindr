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
  // Ephemeral cache so getById() works for memories fetched in the same process lifetime.
  private readonly cache = new Map<string, MindrMemory>()

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
    const memory = episodeToMemory(ep)
    this.cache.set(memory.id, memory)
    return memory
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
    const memories = res.results.map(searchResultToMemory)
    for (const m of memories) this.cache.set(m.id, m)
    return memories
  }

  async forget(memoryId: string): Promise<void> {
    await this.client.forgetEpisode(memoryId)
    this.cache.delete(memoryId)
  }

  async listByTags(tags: MindrTag[], limit = 50): Promise<MindrMemory[]> {
    const res = await this.client.search({
      query: '',
      tags: tagsToStrings(tags),
      limit,
      searchMode: 'keyword',
    })
    const memories = res.results.map(searchResultToMemory)
    for (const m of memories) this.cache.set(m.id, m)
    return memories
  }

  async searchByCommitSet(
    commits: string[],
    lineageFallback: string[],
    additionalTags?: MindrTag[],
  ): Promise<MindrMemory[]> {
    const searchTags = [
      ...commits.map((sha) => `mindr:git_commit:${sha}`),
      ...lineageFallback.map((b) => `mindr:branch_lineage:${b}`),
    ]
    if (searchTags.length === 0) return []

    const seen = new Set<string>()
    const results: MindrMemory[] = []
    const CHUNK = 50
    for (let i = 0; i < searchTags.length; i += CHUNK) {
      const res = await this.client.search({
        query: '',
        tags: searchTags.slice(i, i + CHUNK),
        limit: 200,
        searchMode: 'keyword',
      })
      for (const memory of res.results.map(searchResultToMemory)) {
        const matchesCommit = memory.tags.some((t) => t.key === 'git_commit' && commits.includes(t.value))
        const matchesLineage = memory.tags.some((t) => t.key === 'branch_lineage' && lineageFallback.includes(t.value))
        if (!matchesCommit && !matchesLineage) continue
        if (seen.has(memory.id)) continue
        seen.add(memory.id)
        this.cache.set(memory.id, memory)
        results.push(memory)
      }
    }

    if (additionalTags && additionalTags.length > 0) {
      return results.filter((m) =>
        additionalTags.every((at) => m.tags.some((mt) => mt.key === at.key && mt.value === at.value)),
      )
    }

    return results
  }

  async getById(memoryId: string): Promise<MindrMemory | null> {
    return this.cache.get(memoryId) ?? null
  }
}
