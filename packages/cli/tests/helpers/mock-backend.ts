import type {
  MemoryBackend,
  MindrMemory,
  MindrSession,
  StoreParams,
  SearchParams,
} from '@ai-emart/mindr-core'
import type { MindrTag } from '@ai-emart/mindr-core'

export class MockBackend implements MemoryBackend {
  readonly stored: MindrMemory[] = []
  private memories: MindrMemory[]
  private forgottenIds = new Set<string>()

  constructor(seed: MindrMemory[] = []) {
    this.memories = [...seed]
  }

  async createSession(): Promise<MindrSession> {
    return { sessionId: 'mock-session', createdAt: new Date().toISOString() }
  }

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

  async search(_: SearchParams): Promise<MindrMemory[]> {
    return this.memories.slice(0, 20)
  }

  async forget(id: string): Promise<void> {
    this.forgottenIds.add(id)
    this.memories = this.memories.filter((m) => m.id !== id)
  }

  hasForgotten(id: string): boolean {
    return this.forgottenIds.has(id)
  }

  async getById(id: string): Promise<MindrMemory | null> {
    return this.memories.find((m) => m.id === id) ?? null
  }

  async listByTags(tags: MindrTag[], limit?: number): Promise<MindrMemory[]> {
    let result = this.memories
    if (tags.length > 0) {
      result = result.filter((m) =>
        tags.every((t) => m.tags.some((mt) => mt.key === t.key && mt.value === t.value)),
      )
    }
    return limit != null ? result.slice(0, limit) : result
  }

  async searchByCommitSet(
    commits: string[],
    lineageFallback: string[],
    additionalTags?: MindrTag[],
  ): Promise<MindrMemory[]> {
    const commitSet = new Set(commits)
    let results = this.memories.filter((m) => {
      const hasCommit = m.tags.some((t) => t.key === 'git_commit' && commitSet.has(t.value))
      const hasBranch = m.tags.some((t) => t.key === 'branch_lineage' && lineageFallback.includes(t.value))
      return hasCommit || hasBranch
    })
    if (additionalTags && additionalTags.length > 0) {
      results = results.filter((m) =>
        additionalTags.every((at) => m.tags.some((mt) => mt.key === at.key && mt.value === at.value)),
      )
    }
    return results
  }
}

/** Capture everything written to process.stdout during fn(). */
export async function captureStdout(fn: () => Promise<void>): Promise<string> {
  let output = ''
  const original = process.stdout.write.bind(process.stdout)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(process.stdout as any).write = (chunk: unknown) => {
    output += String(chunk)
    return true
  }
  try {
    await fn()
  } finally {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(process.stdout as any).write = original
  }
  return output
}
