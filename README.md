# Mindr

**The codebase memory layer for AI coding agents.**

AI coding agents are stateless by default — every session starts from zero, re-learning the same codebase, repeating the same mistakes. Mindr fixes this. It gives every agent — Claude Code, Codex, OpenCode, Cursor, Aider — a persistent, structured memory of your codebase that compounds over time.

[![npm](https://img.shields.io/npm/v/mindr)](https://www.npmjs.com/package/mindr)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## 60-second demo

```bash
# Install
npm install -g mindr

# Set up Mindr in your repo (scans conventions, installs git hook)
cd my-project
mindr init

# Agents now get automatic context on every session.
# You can also store memories manually:
mindr remember "We use tRPC for all internal APIs" --type decision --module api

# Browse stored memories
mindr memory list
mindr memory list --type decision --json

# Generate AGENTS.md from observed patterns
mindr generate agents-md

# Start the MCP server (connects any MCP-compatible agent)
mindr serve
```

---

## What gets remembered — automatically

Every `git commit` triggers the post-commit hook, which:

- **Detects architectural decisions** from commit messages (`refactor`, `migrate`, `decided`, …) and large cross-module diffs
- **Extracts debt** — every TODO / FIXME / HACK with file and line number
- **Updates convention profiles** — naming patterns, file layout, consistency scores (via tree-sitter)
- **Stores commit context** for hot-module tracking

No developer action required after `mindr init`.

---

## Connect to your AI agent

### Claude Code

Add to `.claude/settings.json` in your project root:

```json
{
  "mcpServers": {
    "mindr": { "command": "mindr", "args": ["serve"] }
  }
}
```

### Codex CLI

Add to `codex.toml`:

```toml
[[mcp_servers]]
name    = "mindr"
command = "mindr serve"
```

### OpenCode

Add to `.opencode/config.json`:

```json
{
  "mcp": {
    "servers": {
      "mindr": { "command": "mindr", "args": ["serve"] }
    }
  }
}
```

### Cursor

Add to `.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "mindr": { "command": "mindr", "args": ["serve"] }
  }
}
```

The MCP server exposes context, memory, bug-pattern, context-health, checkpoint, and query tools.
See [`examples/`](examples/) for copy-paste config files.

---

## Context injected into every agent session

```
=== MINDR CONTEXT ===

[WARNINGS]
⚠ TODO src/auth.ts:22 — validate token expiry
⚠ FIXME src/db.ts:45 — handle pool exhaustion

[RECENT DECISIONS]
2024-01-15 · switch to Vitest [core] (keyword)
2024-01-10 · migrate to pnpm workspaces [root] (keyword)

[CONVENTIONS]
typescript
  camelCase         functionNames     97%
  PascalCase        classNames        100%

[STACK]
typescript, react, postgresql, vitest

=== END CONTEXT ===
```

Token-budgeted and priority-ordered. Warnings first, stack last — the agent always sees what matters most regardless of context window pressure.

---

## CLI reference

```bash
mindr init                              # scan repo, install git hook, configure backend
mindr remember <content>               # store a manual memory
  --type decision|debt|note|convention|context|bug_pattern
  --module <name>
  --tag <k:v>                          # repeatable
mindr forget <id>                      # soft-delete a memory by ID
mindr memory list                      # browse memories (table view)
  --type --module --since --limit --sort quality --json
mindr bugs list --module <name>        # known structural bug patterns
mindr debt list --severity high        # technical debt table
mindr debt report                      # markdown debt summary
mindr session health <id>              # context drift score
mindr session checkpoint <id>          # write checkpoint memory
mindr stats --session <id>             # token usage and honest savings range
mindr ui --port 3131                   # local dashboard
mindr generate agents-md               # generate AGENTS.md from observed patterns
mindr generate claude-md               # generate CLAUDE.md
mindr generate --all                   # generate both
mindr serve                            # start MCP server on stdio
mindr status                           # backend type, hook status, memory counts
mindr config get <key>                 # read a config value (dotted path)
mindr config set <key> <value>         # write a config value
mindr migrate sqlite-to-remembr        # migrate local SQLite memories to Remembr
```

---

## TypeScript SDK

```bash
npm i @ai-emart/mindr
```

```ts
import { Mindr } from '@ai-emart/mindr';

const mindr = await Mindr.open({ project: './my-project' });

await mindr.remember('We use tRPC for all internal APIs', { type: 'decision', module: 'api' });
const ctx       = await mindr.getSessionContext({ module: 'auth' });
const decisions = await mindr.query({ type: 'decision', module: 'auth' });
const debt      = await mindr.getDebt();
const conventions = await mindr.getConventions();

mindr.close();
```

See [`packages/sdk/README.md`](packages/sdk/README.md) for the full API reference.

---

## Configuration

`mindr init` creates `.mindr/config.toml`:

```toml
[storage]
backend     = "sqlite"            # "sqlite" (default, zero setup) or "remembr"
sqlite_path = ".mindr/mindr.sqlite"

[remembr]
base_url = ""                     # your Remembr instance URL
# api_key = ""                    # or set REMEMBR_API_KEY env var
```

---

## One-command local setup

```bash
docker compose up
```

Starts Ollama for local embeddings. SQLite backend — zero API keys, fully local, works offline.

---

## Packages

| Package | Description |
| ------- | ----------- |
| [`mindr`](packages/cli) | CLI binary + MCP server |
| [`@ai-emart/mindr`](packages/sdk) | TypeScript SDK |
| [`@ai-emart/mindr-core`](packages/core) | Shared internals (tree-sitter, git, schema) |

---

## Development

```bash
pnpm install
pnpm build    # topological build via Turborepo
pnpm test     # runs all 173 tests across 3 packages
pnpm lint
```

Node 22+ required. See [CONTRIBUTING.md](CONTRIBUTING.md) for contribution guide.

---

## License

[MIT](LICENSE) © 2026 ai-emart
