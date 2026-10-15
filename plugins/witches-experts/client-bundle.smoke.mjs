import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'

let handoff
const source = await readFile(new URL('./lib/client.js', import.meta.url), 'utf8')
vm.runInNewContext(source, {
  window: { __ModuleLoader__: { load(value) { handoff = value } } },
})
assert.equal(handoff?.id, 'witches-experts')
const react = { createElement() {}, useState: (v) => [v, () => {}] }
const externals = { react, 'react-dom': {} }
const seen = []
const exports = handoff.factory((id) => {
  seen.push(id)
  assert.ok(id in externals, 'unexpected external: ' + id)
  return externals[id]
})
assert.deepEqual(Object.keys(exports).sort(), ['apply', 'inject'])
assert.equal(JSON.stringify([...exports.inject]), JSON.stringify(['slots', 'connection']))
assert.ok(seen.includes('react'), 'react must resolve through the factory require, not the bundle')
console.log('witches-experts client bundle registers and exports apply/inject')
