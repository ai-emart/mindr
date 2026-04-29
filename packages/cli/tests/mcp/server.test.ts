import { describe, it, expect } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createMindrServer } from '../../src/mcp/server.js'
import type { MemoryBackend, MindrMemory, MindrSession, StoreParams, SearchParams } from '@ai-emart/mindr-core'
import type { MindrTag } from '@ai-emart/mindr-core'

// ---------------------------------------------------------------------------
// Mock backend
// ---------------------------------------------------------------------------

class MockBackend implements MemoryBackend {
  readonly stored: MindrMemory[] = []
  private memories: MindrMemory[]

  constructor(memories: MindrMemory[] = []) { this.memories = memories }

  async createSession(): Promise<MindrSession> { return { sessionId: 'mock', createdAt: '2024-01-01T00:00:00Z' } }

  async store(params: StoreParams): Promise<MindrMemory> {
    const mem: MindrMemory = {
      id: `mem-${this.stored.length + 1}`,
      role: params.role ?? 'user',
      content: params.content,
      tags: params.tags ?? [],
      metadata: params.metadata ?? null,
      sessionId: params.sessionId ?? null,
      createdAt: new Date().toISOString(),
    }
    this.stored.push(mem)
    this.memories.push(mem)
    return mem
  }

  async search(_: SearchParams): Promise<MindrMemory[]> { return this.memories.slice(0, 20) }
  async forget(_: string): Promise<void> {}
  async getById(_: string): Promise<MindrMemory | null> { return null }

  async listByTags(tags: MindrTag[]): Promise<MindrMemory[]> {
    return this.memories.filter((m) =>
      tags.every((t) => m.tags.some((mt) => mt.key === t.key && mt.value === t.value)),
    )
  }
}

function mem(overrides: Partial<MindrMemory> & Pick<MindrMemory, 'content' | 'tags'>): MindrMemory {
  return {
    id: 'fixture-id',
    role: 'system',
    createdAt: '2024-01-15T10:00:00Z',
    metadata: null,
    sessionId: null,
    ...overrides,
  }
}

const FIXTURE_MEMORIES: MindrMemory[] = [
  // Convention profile
  mem({
    content: 'Convention profile for typescript',
    tags: [{ key: 'type', value: 'convention' }, { key: 'language', value: 'typescript' }],
    metadata: {
      language: 'typescript',
      profile: {
        language: 'typescript',
        analyzedFiles: 5,
        analyzedAt: '2024-01-15T09:00:00Z',
        conventions: [
          { pattern: 'camelCase', category: 'functionNames', score: 95, sampleCount: 10 },
        ],
      },
    },
  }),
  // Decision
  mem({
    content: 'Decision: switch to ESM everywhere',
    tags: [{ key: 'type', value: 'decision' }, { key: 'module', value: 'root' }],
    createdAt: '2024-01-14T08:00:00Z',
    metadata: { date: '2024-01-14', trigger: 'keyword' },
  }),
  // Debt
  mem({
    content: 'TODO at src/parser.ts:10 — handle edge cases',
    tags: [{ key: 'type', value: 'debt' }],
    metadata: { file: 'src/parser.ts', line: 10, keyword: 'TODO' },
  }),
]

// ---------------------------------------------------------------------------
// In-process MCP client/server setup helper
// ---------------------------------------------------------------------------

async function makeConnectedPair(backend: MemoryBackend) {
  const server = createMindrServer(backend)
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await server.connect(serverTransport)
  const client = new Client({ name: 'test-client', version: '1.0.0' }, { capabilities: {} })
  await client.connect(clientTransport)
  return { client, server }
}

// ---------------------------------------------------------------------------
// Tool list
// ---------------------------------------------------------------------------

describe('MCP server — tool list', () => {
  it('lists exactly 3 tools', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const { tools } = await client.listTools()
    expect(tools).toHaveLength(3)
  })

  it('tool names are mindr:get_context, mindr:remember, mindr:query', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const { tools } = await client.listTools()
    const names = tools.map((t) => t.name).sort()
    expect(names).toEqual(['mindr:get_context', 'mindr:query', 'mindr:remember'])
  })

  it('each tool has a description and inputSchema', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const { tools } = await client.listTools()
    for (const tool of tools) {
      expect(tool.description).toBeTruthy()
      expect(tool.inputSchema).toBeDefined()
    }
  })
})

// ---------------------------------------------------------------------------
// mindr:get_context
// ---------------------------------------------------------------------------

describe('MCP tool — mindr:get_context', () => {
  it('returns text content with MINDR CONTEXT header', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const result = await client.callTool({ name: 'mindr:get_context', arguments: {} })
    expect(result.content).toHaveLength(1)
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('=== MINDR CONTEXT ===')
    expect(text).toContain('=== END CONTEXT ===')
  })

  it('respects max_tokens budget', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const full   = await client.callTool({ name: 'mindr:get_context', arguments: {} })
    const trimmed = await client.callTool({ name: 'mindr:get_context', arguments: { max_tokens: 30 } })
    const fullText    = (full.content[0]    as { type: string; text: string }).text
    const trimmedText = (trimmed.content[0] as { type: string; text: string }).text
    expect(trimmedText.length).toBeLessThanOrEqual(fullText.length)
  })

  it('includes convention data from stored profiles', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const result = await client.callTool({ name: 'mindr:get_context', arguments: {} })
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('typescript')
  })

  it('includes warnings from stored debt', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const result = await client.callTool({ name: 'mindr:get_context', arguments: {} })
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('TODO')
  })
})

// ---------------------------------------------------------------------------
// mindr:remember
// ---------------------------------------------------------------------------

describe('MCP tool — mindr:remember', () => {
  it('stores the memory and returns a confirmation', async () => {
    const backend = new MockBackend([])
    const { client } = await makeConnectedPair(backend)

    const result = await client.callTool({
      name: 'mindr:remember',
      arguments: { content: 'decided to use ESM everywhere', type: 'decision', module: 'root' },
    })

    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('Stored memory')
    expect(backend.stored).toHaveLength(1)
    expect(backend.stored[0].content).toBe('decided to use ESM everywhere')
  })

  it('attaches type and module tags', async () => {
    const backend = new MockBackend([])
    const { client } = await makeConnectedPair(backend)

    await client.callTool({
      name: 'mindr:remember',
      arguments: { content: 'test memory', type: 'note', module: 'auth' },
    })

    const stored = backend.stored[0]
    expect(stored.tags.some((t) => t.key === 'type'   && t.value === 'note')).toBe(true)
    expect(stored.tags.some((t) => t.key === 'module' && t.value === 'auth')).toBe(true)
  })

  it('merges extra tags from the tags argument', async () => {
    const backend = new MockBackend([])
    const { client } = await makeConnectedPair(backend)

    await client.callTool({
      name: 'mindr:remember',
      arguments: {
        content: 'tagged memory',
        type: 'note',
        tags: [{ key: 'ticket', value: 'PROJ-42' }],
      },
    })

    const stored = backend.stored[0]
    expect(stored.tags.some((t) => t.key === 'ticket' && t.value === 'PROJ-42')).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// mindr:query
// ---------------------------------------------------------------------------

describe('MCP tool — mindr:query', () => {
  it('returns memories matching type filter', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const result = await client.callTool({
      name: 'mindr:query',
      arguments: { type: 'decision' },
    })
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('decision')
    expect(text).toContain('switch to ESM')
  })

  it('returns memories matching module filter', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const result = await client.callTool({
      name: 'mindr:query',
      arguments: { type: 'decision', module: 'root' },
    })
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('switch to ESM')
  })

  it('returns "No memories found" for unmatched filter', async () => {
    const { client } = await makeConnectedPair(new MockBackend(FIXTURE_MEMORIES))
    const result = await client.callTool({
      name: 'mindr:query',
      arguments: { type: 'decision', module: 'nonexistent-module-xyz' },
    })
    const text = (result.content[0] as { type: string; text: string }).text
    expect(text).toContain('No memories found')
  })

  it('respects the limit argument', async () => {
    // Add 5 decisions to the fixture
    const many = Array.from({ length: 5 }, (_, i) =>
      mem({
        content: `Decision: choice ${i}`,
        tags: [{ key: 'type', value: 'decision' }, { key: 'module', value: 'root' }],
        metadata: { date: '2024-01-01' },
      }),
    )
    const { client } = await makeConnectedPair(new MockBackend(many))
    const result = await client.callTool({
      name: 'mindr:query',
      arguments: { type: 'decision', limit: 2 },
    })
    const text = (result.content[0] as { type: string; text: string }).text
    // Two decisions = two lines starting with '['
    const lines = text.split('\n').filter((l) => l.startsWith('['))
    expect(lines).toHaveLength(2)
  })
})
