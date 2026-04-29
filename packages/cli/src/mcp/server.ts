// Mindr MCP server — exposes memory tools via the Model Context Protocol.

import { Server } from '@modelcontextprotocol/sdk/server'
import { ListToolsRequestSchema, CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import type { MemoryBackend } from '@ai-emart/mindr-core'
import { buildSessionContext } from '@ai-emart/mindr-core'

// ---------------------------------------------------------------------------
// Tool definitions (JSON Schema)
// ---------------------------------------------------------------------------

const TOOLS = [
  {
    name: 'mindr:get_context',
    description:
      'Returns structured session context: stack, recent decisions, hot modules, active conventions, and warnings. Use this at the start of a session to orient yourself in the codebase.',
    inputSchema: {
      type: 'object',
      properties: {
        module:     { type: 'string',  description: 'Focus on a specific module or directory' },
        files:      { type: 'array', items: { type: 'string' }, description: 'Changed files for scoped context' },
        max_tokens: { type: 'number', description: 'Token budget for the response (default: unlimited)' },
      },
    },
  },
  {
    name: 'mindr:remember',
    description: 'Store a manual memory — a decision, note, bug pattern, or convention observation.',
    inputSchema: {
      type: 'object',
      required: ['content', 'type'],
      properties: {
        content: { type: 'string', description: 'The memory text to store' },
        type:    {
          type: 'string',
          enum: ['decision', 'convention', 'bug_pattern', 'debt', 'note', 'context'],
          description: 'Memory type',
        },
        module:  { type: 'string', description: 'Module or component this memory relates to' },
        tags:    {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, value: { type: 'string' } },
            required: ['key', 'value'],
          },
          description: 'Additional key/value tags',
        },
      },
    },
  },
  {
    name: 'mindr:query',
    description: 'Query stored memories by type, module, or recency.',
    inputSchema: {
      type: 'object',
      properties: {
        type:   {
          type: 'string',
          enum: ['decision', 'convention', 'bug_pattern', 'debt', 'note', 'context'],
          description: 'Filter by memory type',
        },
        module: { type: 'string', description: 'Filter by module tag' },
        since:  { type: 'string', description: 'ISO date — only return memories created after this date' },
        limit:  { type: 'number', description: 'Maximum number of results (default: 20)' },
      },
    },
  },
]

// ---------------------------------------------------------------------------
// Tool handlers
// ---------------------------------------------------------------------------

type JsonObj = Record<string, unknown>

async function handleGetContext(args: JsonObj, backend: MemoryBackend): Promise<string> {
  const ctx = await buildSessionContext(backend, {
    module:     typeof args['module']     === 'string' ? args['module']     : undefined,
    files:      Array.isArray(args['files']) ? args['files'] as string[]    : undefined,
    max_tokens: typeof args['max_tokens'] === 'number' ? args['max_tokens'] : undefined,
  })
  return ctx.summary
}

async function handleRemember(args: JsonObj, backend: MemoryBackend): Promise<string> {
  const content = String(args['content'] ?? '')
  const type    = String(args['type']    ?? 'note')
  const module  = typeof args['module'] === 'string' ? args['module'] : 'root'

  const baseTags = [
    { key: 'type',   value: type },
    { key: 'module', value: module },
  ]
  const extraTags: Array<{ key: string; value: string }> = []
  if (Array.isArray(args['tags'])) {
    for (const t of args['tags']) {
      if (t && typeof t === 'object' && 'key' in t && 'value' in t) {
        extraTags.push({ key: String(t.key), value: String(t.value) })
      }
    }
  }

  const memory = await backend.store({
    content,
    role: 'user',
    tags: [...baseTags, ...extraTags],
  })
  return `Stored memory ${memory.id.slice(0, 8)} (type=${type}, module=${module})`
}

async function handleQuery(args: JsonObj, backend: MemoryBackend): Promise<string> {
  const tags: Array<{ key: string; value: string }> = []
  if (typeof args['type']   === 'string') tags.push({ key: 'type',   value: args['type'] })
  if (typeof args['module'] === 'string') tags.push({ key: 'module', value: args['module'] })

  const limit = typeof args['limit'] === 'number' ? args['limit'] : 20
  const since = typeof args['since'] === 'string' ? new Date(args['since']) : undefined

  const mems = tags.length > 0
    ? await backend.listByTags(tags, limit * 2)   // over-fetch for date filtering
    : await backend.search({ query: '', limit: limit * 2 })

  const filtered = since
    ? mems.filter((m) => new Date(m.createdAt) >= since)
    : mems

  const results = filtered.slice(0, limit)

  if (results.length === 0) return 'No memories found matching the given filters.'

  return results
    .map((m) => {
      const typeTag  = m.tags.find((t) => t.key === 'type')?.value  ?? '?'
      const modTag   = m.tags.find((t) => t.key === 'module')?.value ?? '?'
      const date     = m.createdAt.slice(0, 10)
      return `[${date}] [${typeTag}/${modTag}] ${m.content}`
    })
    .join('\n')
}

// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------

export function createMindrServer(backend: MemoryBackend): Server {
  const server = new Server(
    { name: 'mindr', version: '0.0.1' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const name = request.params.name
    const args = (request.params.arguments ?? {}) as JsonObj

    let text: string
    try {
      switch (name) {
        case 'mindr:get_context': text = await handleGetContext(args, backend); break
        case 'mindr:remember':    text = await handleRemember(args, backend);   break
        case 'mindr:query':       text = await handleQuery(args, backend);      break
        default: text = `Unknown tool: ${name}`
      }
    } catch (err) {
      text = `Error: ${String(err)}`
    }

    return { content: [{ type: 'text' as const, text }] }
  })

  return server
}
