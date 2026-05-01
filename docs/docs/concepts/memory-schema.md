# Memory Schema

Mindr exposes tags as `{key, value}` objects and stores them on the wire as `mindr:<key>:<value>` strings. `packages/core/src/schema.ts` is the conversion boundary.
