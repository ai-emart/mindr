// Shared data types and gatherers for all generator targets.

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { parse as parseTOML } from '@iarna/toml'
import { simpleGit } from 'simple-git'
import type { MemoryBackend, MindrMemory } from '../storage/backend.js'
import type { ConventionProfile } from '../conventions/detector.js'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ProjectMeta {
  name: string
  description: string
  version: string
  language: 'typescript' | 'javascript' | 'python' | 'go' | 'rust' | 'mixed' | 'unknown'
  repoUrl: string | null
}

export type StackCategory = 'language' | 'framework' | 'database' | 'testing' | 'tooling' | 'other'

export interface StackItem {
  name: string
  role: string
  category: StackCategory
}

export interface GenerateContext {
  meta: ProjectMeta
  stack: StackItem[]
  conventions: ConventionProfile[]   // latest per language, sorted by language name asc
  decisions: MindrMemory[]           // top 5 most recent
  debt: MindrMemory[]                // all active debt, sorted by content asc
}

// ---------------------------------------------------------------------------
// Stack knowledge base
// ---------------------------------------------------------------------------

interface KnownDep { name: string; role: string; category: StackCategory }

const KNOWN_DEPS: Record<string, KnownDep> = {
  // Language markers
  typescript:           { name: 'TypeScript',        role: 'language',                  category: 'language'   },
  // Frontend
  react:                { name: 'React',              role: 'UI library',                category: 'framework'  },
  next:                 { name: 'Next.js',            role: 'React framework',           category: 'framework'  },
  vue:                  { name: 'Vue',                role: 'UI framework',              category: 'framework'  },
  nuxt:                 { name: 'Nuxt',               role: 'Vue framework',             category: 'framework'  },
  svelte:               { name: 'Svelte',             role: 'UI framework',              category: 'framework'  },
  '@sveltejs/kit':      { name: 'SvelteKit',          role: 'Svelte framework',          category: 'framework'  },
  astro:                { name: 'Astro',              role: 'web framework',             category: 'framework'  },
  'solid-js':           { name: 'SolidJS',            role: 'UI library',                category: 'framework'  },
  // Backend
  express:              { name: 'Express',            role: 'HTTP server',               category: 'framework'  },
  fastify:              { name: 'Fastify',            role: 'HTTP server',               category: 'framework'  },
  koa:                  { name: 'Koa',                role: 'HTTP server',               category: 'framework'  },
  '@nestjs/core':       { name: 'NestJS',             role: 'backend framework',         category: 'framework'  },
  hono:                 { name: 'Hono',               role: 'HTTP framework',            category: 'framework'  },
  elysia:               { name: 'Elysia',             role: 'HTTP framework',            category: 'framework'  },
  // DB / ORM
  '@prisma/client':     { name: 'Prisma',             role: 'ORM',                       category: 'database'   },
  typeorm:              { name: 'TypeORM',             role: 'ORM',                       category: 'database'   },
  'drizzle-orm':        { name: 'Drizzle',            role: 'ORM',                       category: 'database'   },
  mongoose:             { name: 'Mongoose',           role: 'MongoDB ODM',               category: 'database'   },
  sequelize:            { name: 'Sequelize',          role: 'ORM',                       category: 'database'   },
  'better-sqlite3':     { name: 'SQLite',             role: 'embedded database',         category: 'database'   },
  pg:                   { name: 'PostgreSQL',         role: 'database client',           category: 'database'   },
  mysql2:               { name: 'MySQL',              role: 'database client',           category: 'database'   },
  ioredis:              { name: 'Redis',              role: 'cache / pub-sub',           category: 'database'   },
  // Testing
  vitest:               { name: 'Vitest',             role: 'test runner',               category: 'testing'    },
  jest:                 { name: 'Jest',               role: 'test runner',               category: 'testing'    },
  mocha:                { name: 'Mocha',              role: 'test runner',               category: 'testing'    },
  '@playwright/test':   { name: 'Playwright',         role: 'E2E testing',               category: 'testing'    },
  cypress:              { name: 'Cypress',            role: 'E2E testing',               category: 'testing'    },
  // APIs
  graphql:              { name: 'GraphQL',            role: 'API query language',        category: 'framework'  },
  '@apollo/server':     { name: 'Apollo Server',      role: 'GraphQL server',            category: 'framework'  },
  '@trpc/server':       { name: 'tRPC',               role: 'typesafe RPC',              category: 'framework'  },
  // Validation
  zod:                  { name: 'Zod',                role: 'schema validation',         category: 'tooling'    },
  joi:                  { name: 'Joi',                role: 'schema validation',         category: 'tooling'    },
  // Build / monorepo
  vite:                 { name: 'Vite',               role: 'build tool',                category: 'tooling'    },
  turbo:                { name: 'Turborepo',          role: 'monorepo build system',     category: 'tooling'    },
  nx:                   { name: 'Nx',                 role: 'monorepo build system',     category: 'tooling'    },
  tsup:                 { name: 'tsup',               role: 'TypeScript bundler',        category: 'tooling'    },
  // CSS
  tailwindcss:          { name: 'Tailwind CSS',       role: 'CSS framework',             category: 'tooling'    },
  // Auth
  'next-auth':          { name: 'NextAuth',           role: 'authentication',            category: 'tooling'    },
  '@auth/core':         { name: 'Auth.js',            role: 'authentication',            category: 'tooling'    },
  // Queue
  bullmq:               { name: 'BullMQ',             role: 'job queue',                 category: 'tooling'    },
}

const CATEGORY_ORDER: StackCategory[] = ['language', 'framework', 'database', 'testing', 'tooling', 'other']

function categorySortKey(cat: StackCategory): number {
  const idx = CATEGORY_ORDER.indexOf(cat)
  return idx === -1 ? CATEGORY_ORDER.length : idx
}

// ---------------------------------------------------------------------------
// Project metadata detection
// ---------------------------------------------------------------------------

function remoteToUrl(remote: string): string | null {
  // git@github.com:user/repo.git → https://github.com/user/repo
  const ssh = remote.match(/^git@([^:]+):(.+?)(?:\.git)?$/)
  if (ssh) return `https://${ssh[1]}/${ssh[2]}`
  // https://github.com/user/repo.git → https://github.com/user/repo
  const https = remote.match(/^(https?:\/\/.+?)(?:\.git)?$/)
  if (https) return https[1]
  return null
}

async function getGitRemoteUrl(repoRoot: string): Promise<string | null> {
  try {
    const git = simpleGit({ baseDir: repoRoot })
    const remotes = await git.getRemotes(true)
    const origin = remotes.find((r) => r.name === 'origin')
    const url = origin?.refs?.fetch ?? origin?.refs?.push ?? null
    return url ? remoteToUrl(url) : null
  } catch {
    return null
  }
}

function readJsonSafe(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function readTomlSafe(path: string): Record<string, unknown> | null {
  try {
    return parseTOML(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

export async function getProjectMeta(repoRoot: string): Promise<ProjectMeta> {
  const repoUrl = await getGitRemoteUrl(repoRoot)

  // Node / TS
  const pkg = readJsonSafe(join(repoRoot, 'package.json'))
  if (pkg) {
    const hasTsInDeps =
      !!(pkg['devDependencies'] as Record<string, unknown> | undefined)?.['typescript']
    const hasTsFiles = existsSync(join(repoRoot, 'tsconfig.json'))
    return {
      name: String(pkg['name'] ?? 'unknown'),
      description: String(pkg['description'] ?? ''),
      version: String(pkg['version'] ?? '0.0.0'),
      language: hasTsInDeps || hasTsFiles ? 'typescript' : 'javascript',
      repoUrl,
    }
  }

  // Python
  const pyproject = readTomlSafe(join(repoRoot, 'pyproject.toml'))
  if (pyproject) {
    const project = pyproject['project'] as Record<string, unknown> | undefined
    const poetry = (pyproject['tool'] as Record<string, unknown> | undefined)?.['poetry'] as
      | Record<string, unknown>
      | undefined
    const src = project ?? poetry ?? {}
    return {
      name: String(src['name'] ?? 'unknown'),
      description: String(src['description'] ?? ''),
      version: String(src['version'] ?? '0.0.0'),
      language: 'python',
      repoUrl,
    }
  }

  // Go
  if (existsSync(join(repoRoot, 'go.mod'))) {
    const gomod = readFileSync(join(repoRoot, 'go.mod'), 'utf8')
    const moduleName = gomod.match(/^module\s+(\S+)/m)?.[1] ?? 'unknown'
    const name = moduleName.split('/').at(-1) ?? moduleName
    return { name, description: '', version: '0.0.0', language: 'go', repoUrl }
  }

  // Rust
  const cargo = readTomlSafe(join(repoRoot, 'Cargo.toml'))
  if (cargo) {
    const pkg2 = cargo['package'] as Record<string, unknown> | undefined
    return {
      name: String(pkg2?.['name'] ?? 'unknown'),
      description: String(pkg2?.['description'] ?? ''),
      version: String(pkg2?.['version'] ?? '0.0.0'),
      language: 'rust',
      repoUrl,
    }
  }

  return { name: repoRoot.split(/[\\/]/).at(-1) ?? 'unknown', description: '', version: '0.0.0', language: 'unknown', repoUrl }
}

export function detectStack(repoRoot: string): StackItem[] {
  const allDeps: string[] = []

  // Node: package.json
  const pkg = readJsonSafe(join(repoRoot, 'package.json'))
  if (pkg) {
    const deps = pkg['dependencies'] as Record<string, unknown> | undefined
    const devDeps = pkg['devDependencies'] as Record<string, unknown> | undefined
    allDeps.push(...Object.keys(deps ?? {}), ...Object.keys(devDeps ?? {}))
    // If TypeScript config exists but no explicit 'typescript' dep, flag it
    if (existsSync(join(repoRoot, 'tsconfig.json')) && !allDeps.includes('typescript')) {
      allDeps.push('typescript')
    }
  }

  // Python: pyproject.toml
  const pyproject = readTomlSafe(join(repoRoot, 'pyproject.toml'))
  if (pyproject) {
    const project = pyproject['project'] as Record<string, unknown> | undefined
    const deps2 = project?.['dependencies'] as string[] | undefined
    if (Array.isArray(deps2)) allDeps.push(...deps2.map((d) => d.split(/[>=<[;]/)[0].trim()))
  }

  // Collect unique matches
  const seen = new Set<string>()
  const items: StackItem[] = []
  for (const dep of allDeps) {
    const known = KNOWN_DEPS[dep]
    if (known && !seen.has(known.name)) {
      seen.add(known.name)
      items.push({ name: known.name, role: known.role, category: known.category })
    }
  }

  return items.sort((a, b) => {
    const catDiff = categorySortKey(a.category) - categorySortKey(b.category)
    return catDiff !== 0 ? catDiff : a.name.localeCompare(b.name)
  })
}

// ---------------------------------------------------------------------------
// Backend data queries
// ---------------------------------------------------------------------------

export async function queryConventions(backend: MemoryBackend): Promise<ConventionProfile[]> {
  const mems = await backend.listByTags([{ key: 'type', value: 'convention' }])
  mems.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const latestByLang = new Map<string, ConventionProfile>()
  for (const m of mems) {
    const lang = m.tags.find((t) => t.key === 'language')?.value
    if (lang && !latestByLang.has(lang) && m.metadata?.profile) {
      latestByLang.set(lang, m.metadata.profile as ConventionProfile)
    }
  }
  return Array.from(latestByLang.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v)
}

export async function queryDecisions(backend: MemoryBackend, limit = 5): Promise<MindrMemory[]> {
  const mems = await backend.listByTags([{ key: 'type', value: 'decision' }])
  return mems.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

export async function queryDebt(backend: MemoryBackend): Promise<MindrMemory[]> {
  const mems = await backend.listByTags([{ key: 'type', value: 'debt' }])
  return mems.sort((a, b) => a.content.localeCompare(b.content))
}

// ---------------------------------------------------------------------------
// Main context gatherer
// ---------------------------------------------------------------------------

export async function gatherContext(repoRoot: string, backend: MemoryBackend): Promise<GenerateContext> {
  const [meta, conventions, decisions, debt] = await Promise.all([
    getProjectMeta(repoRoot),
    queryConventions(backend),
    queryDecisions(backend),
    queryDebt(backend),
  ])
  const stack = detectStack(repoRoot)
  return { meta, stack, conventions, decisions, debt }
}
