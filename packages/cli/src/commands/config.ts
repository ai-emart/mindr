import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import type { Command } from 'commander'
import { parse as tomlParse, stringify as tomlStringify } from '@iarna/toml'
import { getRepoRoot } from '@ai-emart/mindr-core'
import chalk from 'chalk'

export interface ConfigDeps {
  repoRoot?: string
}

type JsonMap = { [key: string]: unknown }

function getConfigPath(repoRoot: string): string {
  return join(repoRoot, '.mindr', 'config.toml')
}

function getNestedValue(obj: JsonMap, path: string): unknown {
  const parts = path.split('.')
  let cur: unknown = obj
  for (const p of parts) {
    if (cur == null || typeof cur !== 'object' || Array.isArray(cur)) return undefined
    cur = (cur as JsonMap)[p]
  }
  return cur
}

function setNestedValue(obj: JsonMap, path: string, value: string): void {
  const parts = path.split('.')
  let cur = obj
  for (let i = 0; i < parts.length - 1; i++) {
    const p = parts[i]!
    if (cur[p] == null || typeof cur[p] !== 'object') cur[p] = {}
    cur = cur[p] as JsonMap
  }
  cur[parts[parts.length - 1]!] = value
}

export async function runConfigGet(key: string, deps: ConfigDeps = {}): Promise<void> {
  const repoRoot = deps.repoRoot ?? (await getRepoRoot(process.cwd()))
  const configPath = getConfigPath(repoRoot)

  if (!existsSync(configPath)) {
    throw new Error('No .mindr/config.toml found. Run mindr init first.')
  }

  const parsed = tomlParse(readFileSync(configPath, 'utf8')) as JsonMap
  const value = getNestedValue(parsed, key)

  if (value === undefined) {
    throw new Error(`Key "${key}" not found.`)
  }

  process.stdout.write(String(value) + '\n')
}

export async function runConfigSet(key: string, value: string, deps: ConfigDeps = {}): Promise<void> {
  const repoRoot = deps.repoRoot ?? (await getRepoRoot(process.cwd()))
  const mindrDir = join(repoRoot, '.mindr')
  const configPath = getConfigPath(repoRoot)

  let parsed: JsonMap = {}
  if (existsSync(configPath)) {
    parsed = tomlParse(readFileSync(configPath, 'utf8')) as JsonMap
  } else {
    mkdirSync(mindrDir, { recursive: true })
  }

  setNestedValue(parsed, key, value)
  // @iarna/toml stringify expects AnyJson — our JsonMap satisfies it structurally
  writeFileSync(configPath, tomlStringify(parsed as Parameters<typeof tomlStringify>[0]), 'utf8')
  process.stdout.write(`${chalk.green('✓')} Set ${chalk.bold(key)} = ${chalk.dim(value)}\n`)
}

export function addConfigCommands(program: Command, deps: ConfigDeps = {}): void {
  const config = program.command('config').description('Read and write Mindr config')

  config
    .command('get <key>')
    .description('Get a config value by dotted key (e.g. storage.backend)')
    .action(async (key: string) => {
      await runConfigGet(key, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })

  config
    .command('set <key> <value>')
    .description('Set a config value by dotted key')
    .action(async (key: string, value: string) => {
      await runConfigSet(key, value, deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
