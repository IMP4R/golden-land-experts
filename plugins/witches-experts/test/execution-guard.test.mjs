import test from 'node:test'
import assert from 'node:assert/strict'
import { CYCLE_PHASE, ExecutionCycle } from '../lib/execution-cycle.js'
import { CYCLE_RESERVED_TOOLS, installCycleGuard } from '../lib/execution-guard.js'

/** Minimal waterfall host: `pre-execute` runs listeners in registration order. */
function host() {
  const listeners = []
  const registry = new Map()
  const ctx = {
    on(event, listener) {
      if (event !== 'tools/pre-execute') throw new Error(`unexpected event ${event}`)
      listeners.push(listener)
      return () => { const i = listeners.indexOf(listener); if (i >= 0) listeners.splice(i, 1) }
    },
  }
  const dispose = installCycleGuard(ctx, registry)
  const call = (exec) => {
    let index = -1
    const next = async () => {
      index += 1
      return index < listeners.length ? listeners[index](exec, next) : { kind: 'allow' }
    }
    return next()
  }
  return { ctx, registry, dispose, call }
}

function agent(role, options = {}, sessionId = 's1') {
  return { options: { agentRole: role, ...options }, session: { id: sessionId, header: { id: sessionId } } }
}

function executing(registry, sessionId = 's1') {
  const cycle = new ExecutionCycle(sessionId, 'repair')
  cycle.submitFacts({ owner: sessionId, version: 1, role: 'collector' }, ['f'])
  cycle.submitPlan({ owner: sessionId, version: 1, role: 'planner' }, [
    { id: 'w1', goal: 'fix', scope: '/repo', accept: ['tests'], allowedTools: ['read', 'edit'], calls: 1 },
  ])
  const entry = { cycleId: 'c1', cycle, owner: sessionId }
  registry.set(sessionId, entry)
  return entry
}

test('a worker call inside its assignment passes and spends the budget', async () => {
  const { registry, call } = host()
  const entry = executing(registry)
  const worker = agent('worker', { cycleAuthority: { cycleId: 'c1', version: 1, assignmentId: 'w1' } })
  assert.deepEqual(await call({ name: 'edit', agent: worker }), { kind: 'allow' })
  const second = await call({ name: 'edit', agent: worker })
  assert.equal(second.kind, 'deny')
  assert.match(second.reason, /budget exhausted/)
  assert.equal(entry.cycle.inspect().workers[0].remaining, 0)
})

test('worker authority is refused outside its tools, stage, version, and cycle', async () => {
  const { registry, call } = host()
  executing(registry)
  const worker = agent('worker', { cycleAuthority: { cycleId: 'c1', version: 1, assignmentId: 'w1' } })
  const bash = await call({ name: 'bash', agent: worker })
  assert.equal(bash.kind, 'deny')
  assert.match(bash.reason, /outside active worker assignment/)

  const stale = agent('worker', { cycleAuthority: { cycleId: 'c1', version: 9, assignmentId: 'w1' } })
  assert.match((await call({ name: 'edit', agent: stale })).reason, /Stale cycle authority/)

  const foreign = agent('worker', { cycleAuthority: { cycleId: 'other', version: 1, assignmentId: 'w1' } })
  assert.match((await call({ name: 'edit', agent: foreign })).reason, /Stale cycle authority/)

  const collector = agent('expert', { cycleAuthority: { cycleId: 'c1', version: 1, assignmentId: 'w1' } })
  assert.match((await call({ name: 'read', agent: collector })).reason, /assigned worker/)
})

test('the witch cannot mutate or execute while her cycle is executing', async () => {
  const { registry, call } = host()
  executing(registry)
  const witch = agent('witch')
  assert.deepEqual(await call({ name: 'read', agent: witch }), { kind: 'allow' })
  for (const tool of CYCLE_RESERVED_TOOLS) {
    const denied = await call({ name: tool, agent: witch })
    assert.equal(denied.kind, 'deny', `${tool} must be reserved while the cycle executes`)
  }
})

test('outside a cycle the witch keeps her tools and non-cycle agents are untouched', async () => {
  const { registry, call } = host()
  assert.deepEqual(await call({ name: 'bash', agent: agent('witch') }), { kind: 'allow' })
  executing(registry)
  registry.get('s1').cycle.phase = CYCLE_PHASE.PLANNING
  assert.deepEqual(await call({ name: 'bash', agent: agent('witch') }), { kind: 'allow' })
  assert.deepEqual(await call({ name: 'bash', agent: agent('expert') }), { kind: 'allow' })
})

test('an upstream deny is preserved', async () => {
  const listeners = []
  const ctx = { on: (_event, listener) => { listeners.push(listener); return () => {} } }
  const registry = new Map()
  installCycleGuard(ctx, registry)
  const exec = { name: 'bash', agent: agent('witch') }
  const upstream = { kind: 'deny', reason: 'permission' }
  const decision = await listeners[0](exec, async () => upstream)
  assert.deepEqual(decision, upstream)
})

test('disposal removes the policy', async () => {
  const { registry, dispose, call } = host()
  executing(registry)
  dispose()
  assert.deepEqual(await call({ name: 'bash', agent: agent('witch') }), { kind: 'allow' })
})