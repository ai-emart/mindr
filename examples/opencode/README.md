# Mindr × OpenCode

Gives OpenCode persistent memory of your codebase via MCP.

## Setup

1. Install Mindr and initialise your project:

```bash
npm install -g mindr
cd your-project
mindr init
```

2. Copy `opencode.json` from this directory to `.opencode/config.json` in your project root (or merge with your existing config):

```json
{
  "mcp": {
    "servers": {
      "mindr": {
        "command": "mindr",
        "args": ["serve"]
      }
    }
  }
}
```

3. Open OpenCode. Mindr is now connected.

## Available MCP tools

| Tool | Description |
| ---- | ----------- |
| `mindr:get_context` | Returns conventions, decisions, warnings, hot modules |
| `mindr:remember` | Stores a memory |
| `mindr:query` | Queries memories by type / module |
