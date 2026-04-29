# Mindr × Codex CLI

Gives OpenAI Codex CLI persistent memory of your codebase via MCP.

## Setup

1. Install Mindr and initialise your project:

```bash
npm install -g mindr
cd your-project
mindr init
```

2. Add the MCP server to your `codex.toml` (project-level) or `~/.codex/config.toml` (global):

```toml
[[mcp_servers]]
name    = "mindr"
command = "mindr serve"
```

3. Run Codex as usual — Mindr context is injected at session start.

## Available MCP tools

| Tool | Description |
| ---- | ----------- |
| `mindr:get_context` | Returns conventions, decisions, warnings, hot modules |
| `mindr:remember` | Stores a memory |
| `mindr:query` | Queries memories by type / module |

## Example usage

```bash
codex "refactor the billing module"
# Codex calls mindr:get_context, learns about your billing conventions,
# and avoids the patterns flagged in past debt memories.
```
