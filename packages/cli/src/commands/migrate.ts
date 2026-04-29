import type { Command } from 'commander'
import { getRepoRoot, loadConfig, migrateSqliteToRemembr } from '@ai-emart/mindr-core'
import type { MindrConfig } from '@ai-emart/mindr-core'
import chalk from 'chalk'

export interface MigrateDeps {
  repoRoot?: string
  config?: MindrConfig
  // injectable for testing
  migrate?: (config: MindrConfig) => Promise<{ migrated: number }>
}

export async function runMigrateSqliteToRemembr(deps: MigrateDeps = {}): Promise<void> {
  const repoRoot = deps.repoRoot ?? (await getRepoRoot(process.cwd()))
  const config = deps.config ?? loadConfig(repoRoot)
  const migrateImpl = deps.migrate ?? migrateSqliteToRemembr

  if (config.storage.backend !== 'remembr') {
    throw new Error('Config backend is not "remembr". Update storage.backend first.')
  }

  process.stdout.write('Migrating SQLite → Remembr...\n')
  const { migrated } = await migrateImpl(config)
  process.stdout.write(`${chalk.green('✓')} Migrated ${migrated} memories.\n`)
}

export function addMigrateCommands(program: Command, deps: MigrateDeps = {}): void {
  const migrate = program.command('migrate').description('Migration utilities')

  migrate
    .command('sqlite-to-remembr')
    .description('Copy all SQLite memories to the Remembr backend')
    .action(async () => {
      await runMigrateSqliteToRemembr(deps).catch((err: unknown) => {
        process.stderr.write(`${chalk.red('✗')} ${String(err)}\n`)
        process.exit(1)
      })
    })
}
