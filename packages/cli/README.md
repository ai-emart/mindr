# mindr

**Give AI coding agents persistent memory of your codebase.**

AI coding agents are stateless by default — every session starts from zero, re-learning the same codebase, repeating the same mistakes. Mindr fixes this with a git-aware, tree-sitter-powered memory layer that works with Claude Code, Codex, Cursor, Aider, OpenCode, and any MCP-compatible agent.

[![npm](https://img.shields.io/npm/v/mindr)](https://www.npmjs.com/package/mindr)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](https://github.com/ai-emart/mindr/blob/main/LICENSE)

## Install

```bash
npm install -g mindr
```

## 60-second demo

```bash
cd my-project
mindr init                      # scan repo, install git hook, detect conventions

mindr generate agents-md        # auto-generate AGENTS.md from observed patterns
mindr generate claude-md        # auto-generate CLAUDE.md

mindr remember "We use tRPC for all internal APIs" --type decision
mindr memory list
mindr status
```

## MCP setup (Claude Code)

Add to `.claude/settings.json`:

```json
{
  "mcpServers": {
    "mindr": { "command": "mindr", "args": ["serve"] }
  }
}
```

Every new session now gets automatic context — decisions, conventions, hot modules, active debt — injected before the first message.

## CLI reference

```
mindr init                       Set up Mindr in current repo
mindr remember <text>            Store a memory manually
mindr forget <id>                Delete a memory
mindr memory list                Browse stored memories
mindr decisions                  Browse architectural decisions
mindr replay                     Chronological decision timeline
mindr debt list                  Browse technical debt
mindr debt add <text>            Add a debt item manually
mindr bugs                       Browse bug pattern memory
mindr branch status              Branch-aware memory view
mindr session health             Context pollution score
mindr stats                      Token savings report
mindr generate agents-md         Generate AGENTS.md
mindr generate claude-md         Generate CLAUDE.md
mindr serve                      Start MCP server
mindr ui                         Open local dashboard (localhost:3131)
mindr status                     Health check
mindr migrate                    Migrate SQLite → Remembr cloud
mindr config get <key>           Read config value
mindr config set <key> <value>   Write config value
```

## Documentation

Full docs, integration guides, and SDK reference: [github.com/ai-emart/mindr](https://github.com/ai-emart/mindr)

## License

MIT
