# Mindr × Cursor

Gives Cursor persistent memory of your codebase via MCP.

## Setup

1. Install Mindr and initialise your project:

```bash
npm install -g mindr
cd your-project
mindr init
```

2. Copy `.cursor/mcp.json` from this directory into your project root (or merge with your existing config):

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

Alternatively add it to your global Cursor MCP config at `~/.cursor/mcp.json` to enable Mindr across all projects.

3. Restart Cursor — the Mindr MCP tools will appear in the tool selector.

## Available MCP tools

| Tool | Description |
| ---- | ----------- |
| `mindr:get_context` | Returns conventions, decisions, warnings, hot modules |
| `mindr:remember` | Stores a memory (Cursor Agent can call this mid-session) |
| `mindr:query` | Queries memories by type / module |

## Tip

Add this to your `.cursorrules` to instruct Cursor Agent to use Mindr automatically:

```
At the start of every session, call mindr:get_context to load project conventions,
recent decisions, and active warnings before writing any code.
```
