import test from 'node:test'
import assert from 'node:assert/strict'
import { deliverReport } from '../lib/report-delivery.js'

test('idle parent is woken by a settled expert report', () => {
  let idle = true
  const queued = []
  const parent = {
    inject() { throw new Error('Passive injection would leave the report parked') },
    followup(message) { queued.push(message); idle = false },
  }
  const message = { id: 'report-1', role: 'user', content: [{ type: 'text', text: 'settled' }], source: { kind: 'plugin', plugin: 'witches-experts', form: 'cycle-result' } }
  deliverReport(parent, message)
  assert.equal(idle, false)
  assert.equal(queued.length, 1)
  assert.deepEqual(queued[0], message)
})
