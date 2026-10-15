import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const bin = fileURLToPath(new URL('../../node_modules/.bin/esbuild', import.meta.url))
const entry = fileURLToPath(new URL('./src/client.js', import.meta.url))
const outfile = fileURLToPath(new URL('./lib/client.js', import.meta.url))

execFileSync(bin, [
  entry,
  '--bundle',
  '--format=cjs',
  '--platform=browser',
  '--external:react',
  '--external:react-dom',
  `--outfile=${outfile}`,
  '--banner:js=window.__ModuleLoader__.load({ id: "witches-experts", factory: (require) => { var module = { exports: {} }; var exports = module.exports;',
  '--footer:js=return module.exports; } });',
], { cwd: root, stdio: 'inherit' })
