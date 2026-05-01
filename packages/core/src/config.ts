import { readFileSync } from 'fs'
import { join, dirname } from 'path'
import { parse as parseTOML } from '@iarna/toml'

export interface MindrConfig {
  project_name?: string
  language?: string
  paths_ignored?: string[]
  remembr: {
    base_url?: string
    api_key?: string
    org_id?: string
  }
  storage: {
    backend: 'remembr' | 'sqlite'
    sqlite_path: string
  }
  embeddings: {
    provider?: string
  }
}

const DEFAULTS: MindrConfig = {
  remembr: {},
  storage: {
    backend: 'sqlite',
    sqlite_path: '.mindr/mindr.sqlite',
  },
  embeddings: {},
}

function findConfigFile(startDir: string): string | null {
  let dir = startDir
  for (;;) {
    const candidate = join(dir, '.mindr', 'config.toml')
    try {
      readFileSync(candidate)
      return candidate
    } catch {
      const parent = dirname(dir)
      if (parent === dir) return null
      dir = parent
    }
  }
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined
}

function section(parsed: Record<string, unknown>, key: string): Record<string, unknown> {
  const v = parsed[key]
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

export function loadConfig(cwd?: string): MindrConfig {
  const startDir = cwd ?? process.cwd()
  const configPath = findConfigFile(startDir)
  if (!configPath) return structuredClone(DEFAULTS)

  const raw = readFileSync(configPath, 'utf8')
  const parsed = parseTOML(raw) as Record<string, unknown>

  const remembr = section(parsed, 'remembr')
  const storage = section(parsed, 'storage')
  const embeddings = section(parsed, 'embeddings')

  const backend = str(storage['backend'])
  const validBackend: 'remembr' | 'sqlite' =
    backend === 'remembr' || backend === 'sqlite' ? backend : 'sqlite'

  return {
    project_name: str(parsed['project_name']),
    language: str(parsed['language']),
    paths_ignored: Array.isArray(parsed['paths_ignored'])
      ? (parsed['paths_ignored'] as string[])
      : undefined,
    remembr: {
      base_url: str(remembr['base_url']),
      api_key: str(remembr['api_key']) ?? process.env['REMEMBR_API_KEY'],
      org_id: str(remembr['org_id']),
    },
    storage: {
      backend: validBackend,
      sqlite_path: str(storage['sqlite_path']) ?? '.mindr/mindr.sqlite',
    },
    embeddings: {
      provider: str(embeddings['provider']),
    },
  }
}
