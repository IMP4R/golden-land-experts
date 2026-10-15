import test from 'node:test'
import assert from 'node:assert/strict'
import { CYCLE_PHASE, ExecutionCycle, parseStageReply } from '../lib/execution-cycle.js'

const assignment = { id: 'w1', goal: 'repair', scope: '/repo', accept: ['tests pass'], allowedTools: ['read', 'edit'], calls: 2 }

function planned(cycle) {
  cycle.submitFacts({ owner: 'w1-session', version: 1, role: 'collector' }, ['src/a.ts:42'])
  cycle.submitPlan({ owner: 'w1-session', version: 1, role: 'planner' }, [assignment])
}

test('collection precedes planning and planning precedes execution', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair the parser')
  assert.equal(cycle.phase, CYCLE_PHASE.COLLECTING)
  assert.throws(() => cycle.submitPlan({ owner: 'w1-session', version: 1, role: 'planner' }, [assignment]), /not authorized/)
  cycle.submitFacts({ owner: 'w1-session', version: 1, role: 'collector' }, ['src/a.ts:42'])
  assert.equal(cycle.phase, CYCLE_PHASE.PLANNING)
  cycle.submitPlan({ owner: 'w1-session', version: 1, role: 'planner' }, [assignment])
  assert.equal(cycle.phase, CYCLE_PHASE.EXECUTING)
})

test('worker results cannot complete the task; only the reviewer accepts', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair')
  planned(cycle)
  cycle.submitResult({ owner: 'w1-session', version: 1, role: 'worker' }, 'w1', ['tests pass'])
  assert.equal(cycle.phase, CYCLE_PHASE.REVIEWING)
  assert.throws(() => cycle.submitResult({ owner: 'w1-session', version: 1, role: 'worker' }, 'w1', ['again']), /not authorized/)
  cycle.review({ owner: 'w1-session', version: 1, role: 'reviewer' }, true, ['verified by reviewer'])
  assert.equal(cycle.phase, CYCLE_PHASE.COMPLETED)
})

test('rejected review opens a new version and invalidates old worker authority', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair')
  planned(cycle)
  cycle.submitResult({ owner: 'w1-session', version: 1, role: 'worker' }, 'w1', ['partial'])
  cycle.review({ owner: 'w1-session', version: 1, role: 'reviewer' }, false, ['tests still failing'])
  assert.equal(cycle.phase, CYCLE_PHASE.PLANNING)
  assert.equal(cycle.version, 2)
  assert.throws(() => cycle.reserve({ owner: 'w1-session', version: 1, role: 'worker' }, 'w1', 'edit'), /stale/)
})

test('worker budgets and allowed tools are enforced before dispatch', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair')
  planned(cycle)
  const authority = { owner: 'w1-session', version: 1, role: 'worker' }
  assert.throws(() => cycle.reserve(authority, 'w1', 'bash'), /outside active worker assignment/)
  cycle.reserve(authority, 'w1', 'edit')
  cycle.reserve(authority, 'w1', 'edit')
  assert.throws(() => cycle.reserve(authority, 'w1', 'edit'), /budget exhausted/)
})

test('plans are transactional and bound', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair')
  cycle.submitFacts({ owner: 'w1-session', version: 1, role: 'collector' }, ['src/a.ts:42'])
  const authority = { owner: 'w1-session', version: 1, role: 'planner' }
  assert.throws(() => cycle.submitPlan(authority, [assignment, { ...assignment }]), /duplicate/)
  assert.equal(cycle.assignments.size, 0, 'a rejected plan commits nothing')
  assert.throws(() => cycle.submitPlan(authority, [{ ...assignment, allowedTools: ['bash'] }]), /whitelist/)
  assert.throws(() => cycle.submitPlan(authority, [{ ...assignment, calls: 99 }]), /invalid_call_budget/)
  assert.throws(() => cycle.submitPlan(authority, Array.from({ length: 4 }, (_, i) => ({ ...assignment, id: `w${i}` }))), /too_many/)
})

test('pause invalidates outstanding authority and cancel is idempotent', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair')
  planned(cycle)
  cycle.pause('w1-session')
  assert.equal(cycle.phase, CYCLE_PHASE.PAUSED)
  assert.throws(() => cycle.reserve({ owner: 'w1-session', version: 1, role: 'worker' }, 'w1', 'edit'), /stale/)
  assert.throws(() => cycle.pause('other'), /cannot be paused/)
  cycle.resume('w1-session')
  assert.equal(cycle.phase, CYCLE_PHASE.EXECUTING)
  cycle.cancel('w1-session')
  cycle.cancel('w1-session')
  assert.equal(cycle.phase, CYCLE_PHASE.CANCELLED)
})

test('foreign owner never acts', () => {
  const cycle = new ExecutionCycle('w1-session', 'repair')
  assert.throws(() => cycle.submitFacts({ owner: 'other', version: 1, role: 'collector' }, ['x']), /Foreign/)
})

test('stage replies must be exact JSON of the requested role', () => {
  assert.deepEqual(parseStageReply('{"role":"collector","facts":["src/a.ts:42"]}'), { role: 'collector', facts: ['src/a.ts:42'] })
  assert.deepEqual(parseStageReply(JSON.stringify({ role: 'planner', assignments: [assignment] })), { role: 'planner', assignments: [assignment] })
  assert.deepEqual(parseStageReply('{"role":"reviewer","accepted":true,"evidence":["ok"]}'), { role: 'reviewer', accepted: true, evidence: ['ok'] })
  for (const bad of [
    '```json\n{"role":"worker","evidence":["x"]}\n```',
    'Sure! {"role":"worker","evidence":["x"]}',
    '{"role":"reviewer","accepted":"yes","evidence":["x"]}',
    '{"role":"worker","evidence":[]}',
    '{"role":"planner","assignments":[]}',
    '{"role":"worker","evidence":["x"],"extra":1}',
  ]) assert.throws(() => parseStageReply(bad), undefined, `must reject: ${bad}`)
  assert.throws(() => parseStageReply(JSON.stringify({ role: 'worker', evidence: ['y'.repeat(2001)] })), /item_too_large/)
})