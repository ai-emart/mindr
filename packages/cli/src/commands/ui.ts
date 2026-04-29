import type { Command } from 'commander'
import { getBackend, getRepoRoot, loadConfig } from '@ai-emart/mindr-core'
import { createUiServer } from '../ui/server.js'

export function addUiCommand(program: Command): void {
  program.command('ui').option('--port <port>', 'Port', '3131').description('Start the local Mindr dashboard').action(async (opts: { port: string }) => {
    const backend = getBackend(loadConfig(await getRepoRoot(process.cwd())))
    const port = Number.parseInt(opts.port, 10)
    const server = createUiServer({ backend, port })
    server.listen(port, '127.0.0.1', () => {
      process.stdout.write(`Mindr UI listening at http://127.0.0.1:${port}\n`)
    })
    process.on('SIGINT', () => {
      server.close(() => process.exit(0))
    })
  })
}
