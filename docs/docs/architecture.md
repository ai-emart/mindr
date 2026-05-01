# Architecture

Mindr is a TypeScript monorepo with `core`, `sdk`, and `cli` packages. Core owns schema conversion, git watching, context building, quality scoring, bug fingerprints, debt detection, and storage abstraction. The SDK wraps core for programmatic use. The CLI exposes commands, MCP tools, and the local dashboard.

Remembr is accessed only through `@remembr/sdk`; SQLite is the local fallback. Memories belong to commits. Branches are query scopes.
