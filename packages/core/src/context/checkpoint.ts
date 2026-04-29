import type { MemoryBackend, MindrMemory } from '../storage/backend.js'
import { sessionCheckpointTags } from '../schema.js'
import { scoreContextHealth, type ContextHealthResult, type SessionActivity } from './health.js'

export async function getContextHealth(
  backend: MemoryBackend,
  sessionId: string,
): Promise<ContextHealthResult> {
  const memories = await backend.listByTags([{ key: 'session', value: sessionId }], 200)
  const files = new Set<string>()
  const modules = new Set<string>()
  for (const memory of memories) {
    const metadata = memory.metadata ?? {}
    const file = typeof metadata['file'] === 'string' ? metadata['file'] : undefined
    if (file) files.add(file)
    const module = memory.tags.find((tag) => tag.key === 'module')?.value
    if (module) modules.add(module)
  }
  const first = memories.at(-1)
  return scoreContextHealth({
    sessionId,
    filesTouched: [...files],
    modulesTouched: [...modules],
    startedAt: first?.createdAt,
  })
}

export async function checkpointSession(
  backend: MemoryBackend,
  sessionId: string,
  summary?: string,
): Promise<MindrMemory> {
  const memories = await backend.listByTags([{ key: 'session', value: sessionId }], 50)
  const modules = new Set(memories.map((m) => m.tags.find((tag) => tag.key === 'module')?.value).filter((v): v is string => Boolean(v)))
  const content = summary ?? `Session checkpoint ${sessionId}: ${memories.length} related memories across ${modules.size} module(s).`
  return backend.store({
    content,
    role: 'system',
    tags: sessionCheckpointTags({ sessionId, module: modules.values().next().value }),
    sessionId,
    metadata: { sessionId, memoryCount: memories.length, modules: [...modules] },
  })
}

export function healthFromActivity(activity: SessionActivity): ContextHealthResult {
  return scoreContextHealth(activity)
}
