import test from 'node:test'
import assert from 'node:assert/strict'
import { stageOutput, terminalReport } from '../lib/cycle-report.js'

test('failed worker retains QUOTA rather than becoming reply_not_json', () => {
  assert.throws(() => stageOutput({ stopReason: 'error', output: [] }, 'worker', {
    kind: 'error', error: { code: 'QUOTA', message: '402: Token balance exhausted' },
  }), error => error.code === 'QUOTA' && /Token balance exhausted/.test(error.message))
})
test('failed stage with valid partial JSON still fails', () => {
  assert.throws(() => stageOutput({ stopReason: 'aborted', output: [{ type: 'text', text: '{"role":"worker"}' }] }, 'worker'), /aborted/)
})
test('only completed stage output enters the JSON parser', () => {
  assert.equal(stageOutput({ stopReason: 'completed', output: [{ type: 'text', text: 'ok' }] }, 'worker'), 'ok')
})
test('unused worker calls never mean retries or pending review', () => {
  const report = terminalReport('c1', { accepted: false, error: 'QUOTA', workers: [{ id: 'w1', remaining: 3, finished: false }] })
  assert.equal(report.status, 'failed')
  assert.equal(report.automaticContinuation, false)
  assert.equal(report.reviewPending, false)
  assert.equal(report.workers[0].unusedToolCalls, 3)
  assert.match(report.instruction, /NOT retries/)
  assert.equal(report.effectVerified, false)
})
