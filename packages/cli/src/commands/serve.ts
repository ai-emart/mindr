import type { Command } from 'commander'
import { getRepoRoot, loadConfig, getBackend } from '@ai-emart/mindr-core'
import { createMindrServer } from '../mcp/server.js'

export function addServeCommands(program: Command): void {
  program
    .command('serve')
    .description('Start an MCP server — connects any MCP-compatible AI agent to Mindr')
    .action(async () => {
      // All logging MUST go to stderr. stdout is the MCP protocol channel.
      try {
        const repoRoot = await getRepoRoot(process.cwd())
        const config = loadConfig(repoRoot)
        const backend = getBackend(config)

        const { StdioServerTransport } = await import('@modelcontextprotocol/sdk/server/stdio.js')
        const server = createMindrServer(backend)
        const transport = new StdioServerTransport()

        process.stderr.write('mindr: MCP server starting (stdio transport)\n')
        await server.connect(transport)
        process.stderr.write('mindr: MCP server ready — waiting for connections\n')
      } catch (err) {
        process.stderr.write(`mindr: MCP server error — ${String(err)}\n`)
        process.exit(1)
      }
    })
}
