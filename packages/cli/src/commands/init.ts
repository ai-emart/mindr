import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import type { Command } from 'commander'
import {
  getRepoRoot,
  getBackend,
  installPostCommitHook,
  detect,
} from '@ai-emart/mindr-core'
import type { MemoryBackend, MindrConfig } from '@ai-emart/mindr-core'
import chalk from 'chalk'

type BackendChoice = 'sqlite' | 'remembr'

export interface InitAnswers {
  backendChoice: BackendChoice
  remembrUrl?: string
}

export interface InitDeps {
  backend?: MemoryBackend
  repoRoot?: string
  answers?: InitAnswers  // pre-supply to skip interactive prompts
  skipScan?: boolean     // skip convention detection (tests)
}

function buildConfigToml(choice: BackendChoice, remembrUrl?: string): string {
  if (choice === 'remembr') {
    return [
      '[storage]',
      'backend = "remembr"',
      'sqlite_path = ".mindr/mindr.sqlite"',
      '',
      '[remembr]',
      `base_url = "${remembrUrl ?? ''}"`,
      '',
    ].join('\n')
  }
  return [
    '[storage]',
    'backend = "sqlite"',
    'sqlite_path = ".mindr/mindr.sqlite"',
    '',
  ].join('\n')
}

async function gatherAnswers(): Promise<InitAnswers> {
  const { select, input } = await import('@inquirer/prompts')
  const backendChoice = (await select({
    message: 'Where should Mindr store memories?',
    choices: [
      { name: 'Local SQLite  (no setup required)', value: 'sqlite' },
      { name: 'Remembr cloud (requires API key)', value: 'remembr' },
    ],
  })) as BackendChoice

  let remembrUrl: string | undefined
  if (backendChoice === 'remembr') {
    remembrUrl = await input({ message: 'Remembr base URL:' })
  }
  return { backendChoice, remembrUrl }
}

export async function runInit(deps: InitDeps = {}): Promise<void> {
  const repoRoot =
    deps.repoRoot ?? (await getRepoRoot(process.cwd()).catch(() => null))
  if (!repoRoot) {
    throw new Error('Not a git repository. Run git init first.')
  }

  const answers = deps.answers ?? (await gatherAnswers())

  // Write config
  const mindrDir = join(repoRoot, '.mindr')
  mkdirSync(mindrDir, { recursive: true })
  const configPath = join(mindrDir, 'config.toml')
  writeFileSync(configPath, buildConfigToml(answers.backendChoice, answers.remembrUrl), 'utf8')

  // Install hook — idempotent, installPostCommitHook guards against double-install
  installPostCommitHook(repoRoot)

  // First convention scan (non-fatal)
  if (!deps.skipScan) {
    try {
      const config: MindrConfig = {
        project_name: undefined,
        language: undefined,
        paths_ignored: undefined,
        remembr: { base_url: answers.remembrUrl },
        storage: { backend: answers.backendChoice, sqlite_path: '.mindr/mindr.sqlite' },
        embeddings: {},
      }
      const backend = deps.backend ?? getBackend(config)
      const profiles = await detect(repoRoot)
      for (const profile of profiles) {
        await backend.store({
          content: `Convention profile for ${profile.language}`,
          role: 'system',
          tags: [
            { key: 'type', value: 'convention' },
            { key: 'language', value: profile.language },
          ],
          metadata: { language: profile.language, profile },
        })
      }
    } catch {
      // non-fatal — first scan failing must not block setup
    }
  }

  const hookPath = join(repoRoot, '.git', 'hooks', 'post-commit')
  const alreadyExists = existsSync(configPath)
  process.stdout.write(
    [
      '',
      `${chalk.green('✓')} ${chalk.bold('Mindr initialized')}`,
      '',
      `  ${chalk.cyan('Backend:')} ${answers.backendChoice}`,
      `  ${chalk.cyan('Config:')}  ${configPath}`,
      `  ${chalk.cyan('Hook:')}    ${hookPath}`,
      '',
    ].join('\n'),
  )
  void alreadyExists
}

export function addInitCommand(program: Command, deps: InitDeps = {}): void {
  program
    .command('init')
    .description('Initialize Mindr in the current git repository')
    .action(async () => {
      await runInit(deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
