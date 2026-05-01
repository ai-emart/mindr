# Mindr

**Persistent codebase memory for AI coding agents**

AI coding agents are stateless by default — every session starts from zero, re-learning the same codebase, repeating the same mistakes. Mindr fixes this. It gives every agent — Claude Code, Codex, OpenCode, Cursor, Aider — a persistent, structured memory of your codebase that compounds over time.

[![CI](https://github.com/ai-emart/mindr/actions/workflows/ci.yml/badge.svg)](https://github.com/ai-emart/mindr/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/mindr)](https://www.npmjs.com/package/mindr)
[![npm version](https://img.shields.io/npm/v/@ai-emart/mindr)](https://www.npmjs.com/package/@ai-emart/mindr)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Node](https://img.shields.io/node/v/mindr)](https://www.npmjs.com/package/mindr)

---

## 60-Second Demo

```bash
# Install
npm install -g mindr

# Set up Mindr in your repo
cd my-project
mindr init

# Generate AGENTS.md from observed patterns
mindr generate agents-md
```

Sample output:

```markdown
# AGENTS.md

## Project Overview
- Stack: TypeScript, Express, PostgreSQL
- Pattern: tRPC internally, REST externally

## Conventions
- camelCase functions: 97%
- PascalCase classes: 100%
- kebab-case files: 89%

## Recent Decisions
- Apr 17: Switched to tRPC for internal APIs [api-layer]
- Mar 30: JWT + Redis refresh tokens [auth]
- Mar 15: Paystack only, Flutterwave deferred [payments]

## Technical Debt
- src/billing/invoice.ts:47 — Temporary retry logic (43 days)
- src/auth/session.ts:112 — Race condition under high load (12 days)
```

---

## Install

```bash
npm install -g mindr
```

---

## Agent Setup

### Claude Code

Add to `.claude/settings.json`:

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

---

## TypeScript SDK

```bash
npm install @ai-emart/mindr
```

```ts
import { Mindr } from '@ai-emart/mindr';

const mindr = await Mindr.open({ project: './my-project' });

await mindr.remember('We use tRPC for all internal APIs', { type: 'decision', module: 'api' });
const context = await mindr.getSessionContext({ module: 'auth' });
const decisions = await mindr.query({ type: 'decision', module: 'auth' });
const debt = await mindr.getDebt();
const conventions = await mindr.getConventions();

mindr.close();
```

---

## Links

- [Documentation](https://mindr.dev)
- [GitHub](https://github.com/ai-emart/mindr)
- [GitHub Sponsors](https://github.com/sponsors/ai-emart)
- [Discord](https://discord.gg/mindr)

---

## License

[MIT](LICENSE) © 2026 ai-emart
