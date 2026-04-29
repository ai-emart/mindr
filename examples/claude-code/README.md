# Mindr × Claude Code

Gives Claude Code persistent memory of your codebase via MCP.

## Setup

1. Install Mindr and initialise your project:

```bash
npm install -g mindr
cd your-project
mindr init
```

2. Copy `.claude/settings.json` from this directory into your project root (or merge with your existing one):

```json
{
  "mcpServers": {
    "mindr": {
      "command": "mindr",
      "args": ["serve"]
    }
  }
}
```

3. Open Claude Code. Mindr is now connected.

## What Claude Code can do with Mindr

| Tool | What it does |
| ---- | ------------ |
| `mindr:get_context` | Injects conventions, decisions, warnings and hot modules into the session |
| `mindr:remember` | Stores a memory (Claude can call this autonomously) |
| `mindr:query` | Searches memories by type and module |

## Prompting tips

Claude Code picks up Mindr automatically on session start. You can also prompt it directly:

```
Use mindr:get_context to remind yourself about the auth module conventions before editing.
```

```
After we decide on this architecture, use mindr:remember to store the decision.
```
