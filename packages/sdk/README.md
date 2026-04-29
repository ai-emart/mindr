# @ai-emart/mindr

The developer SDK for [Mindr](https://github.com/ai-emart/mindr) — memory-augmented dev tooling.
Store architectural decisions, coding conventions, and tech debt in a local or cloud backend,
then surface them to any AI agent as a structured session context.

## Install

```
npm i @ai-emart/mindr
```

## Quickstart

```ts
import { Mindr } from '@ai-emart/mindr';

const mindr = await Mindr.open({ project: './my-project' });

await mindr.remember('We use tRPC for all internal APIs', { type: 'decision', module: 'api' });
const ctx = await mindr.getSessionContext({ module: 'auth' });
const decisions = await mindr.query({ type: 'decision', module: 'auth' });
const debt = await mindr.getDebt({ severity: 'high' });
const conventions = await mindr.getConventions();
```

## API

### `Mindr.open(opts)`

Opens a client for the given project path. Loads `.mindr/config.toml` (or accepts an injected
config/backend for testing) and returns a connected `Mindr` instance.

```ts
const mindr = await Mindr.open({ project: './my-project' });
// Use an in-memory SQLite database for tests:
const mindr = await Mindr.open({ project: '.', config: { storage: { backend: 'sqlite', sqlite_path: ':memory:' }, ... } });
```

Call `mindr.close()` when done to release file handles.

### Write

| Method | Description |
|--------|-------------|
| `remember(content, opts?)` | Store a memory. `opts`: `type`, `module`, `tags`, `metadata`. |
| `forget(id)` | Soft-delete a memory by ID. |

### Read

| Method | Description |
|--------|-------------|
| `query(opts?)` | Raw `MindrMemory[]` with optional `type`, `module`, `since`, `limit` filters. |
| `getDecisions(opts?)` | Structured `Decision[]`, newest-first, `"Decision: "` prefix stripped. |
| `getDebt(opts?)` | Structured `DebtItem[]` with `location`, `keyword`, `file`, `line`. |
| `getConventions(opts?)` | `ConventionProfile[]` stored by the post-commit hook. |
| `getSessionContext(opts?)` | Token-budgeted `SessionContext` for AI system prompts. |
| `getStatus()` | `MindrStatus` — backend type, project path, per-type counts. |

### Generate

| Method | Description |
|--------|-------------|
| `regenerateAgentsMd(opts?)` | Generate `AGENTS.md` / `CLAUDE.md` from stored patterns. |

### Migrate

| Method | Description |
|--------|-------------|
| `migrateSqliteToRemembr()` | Copy all SQLite memories to Remembr cloud. |

## Memory types

```
decision   — architectural choices and why
convention — code style patterns (auto-detected via tree-sitter)
bug_pattern — recurring bugs
debt       — TODO / FIXME items
note       — free-form notes
context    — commit context (written by the post-commit hook)
```

## Config

Create `.mindr/config.toml` in your project root, or run `mindr init`:

```toml
[storage]
backend    = "sqlite"          # or "remembr"
sqlite_path = ".mindr/mindr.sqlite"

[remembr]
base_url = "https://your-remembr-instance.com"
```

## License

MIT
