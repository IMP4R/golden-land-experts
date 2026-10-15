import test from 'node:test'
import assert from 'node:assert/strict'
import { CYCLE_PHASE, ExecutionCycle } from '../lib/execution-cycle.js'
import { runExpertCycle } from '../lib/cycle-orchestrator.js'

const routes = { cheap: { provider: 'p', model: 'flash' }, expensive: { provider: 'p', model: 'astra' } }
const plan = { role: 'planner', assignments: [{ id: 'w1', goal: 'fix', scope: '/repo', accept: ['tests'], allowedTools: ['edit'], calls: 2 }] }

/** Scripted stage provider; records the order and routes it was driven with. */
function scripted(replies) {
  const calls = []
  const stage = async ({ role, route }) => {
    calls.push({ role, model: route.model })
    const reply = replies[calls.length - 1]
    if (typeof reply === 'function') return reply(calls.length)
    if (reply instanceof Error) throw reply
    return reply
  }
  return { calls, stage }
}

test('cycle runs collector cheap, planner expensive, worker cheap, reviewer expensive', async () => {
  const { calls, stage } = scripted([
    '{"role":"collector","facts":["src/a.ts:42"]}',
    JSON.stringify(plan),
    '{"role":"worker","evidence":["edited src/a.ts"]}',
    '{"role":"reviewer","accepted":true,"evidence":["tests pass"]}',
  ])
  const cycle = new ExecutionCycle('w', 'repair')
  const result = await runExpertCycle({ stage, trace: () => {}, routes, signal: new AbortController().signal, owner: 'w', goal: 'repair', maxReviews: 2, cycle })
  assert.deepEqual(calls, [
    { role: 'collector', model: 'flash' },
    { role: 'planner', model: 'astra' },
    { role: 'worker', model: 'flash' },
    { role: 'reviewer', model: 'astra' },
  ])
  assert.equal(result.accepted, true)
  assert.equal(cycle.phase, CYCLE_PHASE.COMPLETED)
})

test('rejected review replans on a new version with the reviewer evidence', async () => {
  const { calls, stage } = scripted([
    '{"role":"collector","facts":["src/a.ts:42"]}',
    JSON.stringify(plan),
    '{"role":"worker","evidence":["partial"]}',
    '{"role":"reviewer","accepted":false,"evidence":["tests still failing"]}',
    JSON.stringify(plan),
    '{"role":"worker","evidence":["fixed"]}',
    '{"role":"reviewer","accepted":true,"evidence":["tests pass"]}',
  ])
  const cycle = new ExecutionCycle('w', 'repair')
  const result = await runExpertCycle({ stage, trace: () => {}, routes, signal: new AbortController().signal, owner: 'w', goal: 'repair', maxReviews: 2, cycle })
  assert.equal(calls.length, 7)
  assert.equal(result.accepted, true)
  assert.equal(cycle.version, 2, 'a rejection opens a new planning version')
  assert.ok(cycle.facts.includes('tests still failing'))
})

test('exhausted review budget pauses instead of completing', async () => {
  const reject = '{"role":"reviewer","accepted":false,"evidence":["still failing"]}'
  const { stage } = scripted([
    '{"role":"collector","facts":["f"]}', JSON.stringify(plan), '{"role":"worker","evidence":["e"]}', reject,
    JSON.stringify(plan), '{"role":"worker","evidence":["e"]}', reject,
  ])
  const cycle = new ExecutionCycle('w', 'repair')
  const result = await runExpertCycle({ stage, trace: () => {}, routes, signal: new AbortController().signal, owner: 'w', goal: 'repair', maxReviews: 2, cycle })
  assert.equal(result.accepted, false)
  assert.equal(cycle.phase, CYCLE_PHASE.PAUSED)
})

test('a malformed or failing stage ends the task without accepting it', async () => {
  const { stage } = scripted(['not json at all'])
  const cycle = new ExecutionCycle('w', 'repair')
  const result = await runExpertCycle({ stage, trace: () => {}, routes, signal: new AbortController().signal, owner: 'w', goal: 'repair', maxReviews: 2, cycle })
  assert.equal(result.accepted, false)
  assert.equal(cycle.phase, CYCLE_PHASE.CANCELLED)
  assert.equal(result.error, 'reply_not_json')

  const failing = new ExecutionCycle('w2', 'repair')
  const boom = await runExpertCycle({
    stage: async () => { throw new Error('provider down') },
    trace: () => {}, routes, signal: new AbortController().signal, owner: 'w2', goal: 'repair', maxReviews: 1, cycle: failing,
  })
  assert.match(boom.error, /provider down/)
  assert.equal(failing.phase, CYCLE_PHASE.CANCELLED)
})

test('worker evidence is checked against its own assignment', async () => {
  const cycle = new ExecutionCycle('w', 'repair')
  const { stage } = scripted([
    '{"role":"collector","facts":["f"]}',
    JSON.stringify(plan),
    '{"role":"worker","evidence":["edited"]}',
    '{"role":"reviewer","accepted":true,"evidence":["ok"]}',
  ])
  await runExpertCycle({ stage, trace: () => {}, routes, signal: new AbortController().signal, owner: 'w', goal: 'repair', maxReviews: 1, cycle })
  assert.deepEqual(cycle.inspect().workers, [{ id: 'w1', remaining: 2, finished: true }])
})

test('an aborted run never completes the task', async () => {
  const controller = new AbortController()
  controller.abort()
  const cycle = new ExecutionCycle('w', 'repair')
  const result = await runExpertCycle({ stage: async () => '{"role":"collector","facts":["f"]}', trace: () => {}, routes, signal: controller.signal, owner: 'w', goal: 'repair', maxReviews: 1, cycle })
  assert.equal(result.accepted, false)
  assert.equal(cycle.phase, CYCLE_PHASE.CANCELLED)
})