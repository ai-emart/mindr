import type { MindrConfig } from '../config.js'
import type { MemoryBackend } from './backend.js'
import { RemembrBackend } from './remembr-backend.js'
import { SqliteBackend } from './sqlite-backend.js'

export function getBackend(config: MindrConfig): MemoryBackend {
  if (config.storage.backend === 'remembr') {
    return new RemembrBackend(config)
  }
  return new SqliteBackend(config)
}
