# Contributing to Mindr

Thank you for your interest in contributing! This document is a placeholder — detailed contribution guidelines will be added as the project matures.

## Quick start

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Run tests
pnpm test

# Lint
pnpm lint
```

## Package layout

| Package | Name | Purpose |
|---------|------|---------|
| `packages/core` | `@ai-emart/mindr-core` | Shared logic — Remembr client wrapper, schema, tree-sitter, git |
| `packages/sdk` | `@ai-emart/mindr` | Public TypeScript SDK |
| `packages/cli` | `mindr` | CLI binary + MCP server |

## Rules

- TypeScript only — no `any` without a comment explaining why
- ESM only — no CommonJS
- Tests must pass: `pnpm -r test` before every commit
- Use `vitest` for tests, `tsup` for builds, `commander` for CLI, `@modelcontextprotocol/sdk` for MCP
