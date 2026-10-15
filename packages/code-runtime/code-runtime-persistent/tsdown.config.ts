import { defineConfig } from 'tsdown'

/**
 * Bundle the runtime and its invariant companion as ESM. The Python-side code
 * ships verbatim under `py/` (whitelisted in package.json `files`).
 */
export default defineConfig({
  entry: ['lib/types/index.js', 'lib/types/invariant.js'],
  outDir: 'lib',
  format: ['esm'],
  platform: 'node',
  target: 'es2024',
  fixedExtension: false,
  dts: false,
  clean: false,
})
