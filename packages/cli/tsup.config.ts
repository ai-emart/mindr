import { defineConfig } from 'tsup'
import { cpSync } from 'fs'

export default defineConfig([
  {
    entry: ['src/index.ts'],
    format: ['esm'],
    dts: true,
    sourcemap: true,
    clean: true,
  },
  {
    entry: { cli: 'src/cli.ts' },
    format: ['esm'],
    dts: false,
    sourcemap: true,
    banner: { js: '#!/usr/bin/env node' },
    onSuccess: async () => {
      cpSync('src/ui/static', 'dist/static', { recursive: true })
    },
  },
])
