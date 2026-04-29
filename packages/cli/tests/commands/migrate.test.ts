import { describe, it, expect } from 'vitest'
import { Command } from 'commander'
import { addMigrateCommands, runMigrateSqliteToRemembr } from '../../src/commands/migrate.js'
import { captureStdout } from '../helpers/mock-backend.js'
import type { MindrConfig } from '@ai-emart/mindr-core'

const remembrConfig: MindrConfig = {
  storage: { backend: 'remembr', sqlite_path: '.mindr/mindr.sqlite' },
  remembr: { base_url: 'https://example.com' },
  embeddings: {},
}

const sqliteConfig: MindrConfig = {
  storage: { backend: 'sqlite', sqlite_path: '.mindr/mindr.sqlite' },
  remembr: {},
  embeddings: {},
}

describe('mindr migrate sqlite-to-remembr', () => {
  it('calls the migrate function and reports count', async () => {
    let called = false
    const mockMigrate = async () => { called = true; return { migrated: 7 } }
    const out = await captureStdout(() =>
      runMigrateSqliteToRemembr({
        config: remembrConfig,
        repoRoot: '/fake',
        migrate: mockMigrate,
      }),
    )
    expect(called).toBe(true)
    expect(out).toContain('7')
  })

  it('throws when backend is not remembr', async () => {
    await expect(
      runMigrateSqliteToRemembr({ config: sqliteConfig, repoRoot: '/fake' }),
    ).rejects.toThrow('not "remembr"')
  })

  it('--json flag: commander wiring routes to correct action', async () => {
    let called = false
    const mockMigrate = async () => { called = true; return { migrated: 3 } }
    const program = new Command().exitOverride()
    addMigrateCommands(program, {
      config: remembrConfig,
      repoRoot: '/fake',
      migrate: mockMigrate,
    })
    await program.parseAsync(['node', 'mindr', 'migrate', 'sqlite-to-remembr'])
    expect(called).toBe(true)
  })
})
