// Role and event-origin classification.
//
// The Broker was previously gated on `delegationDepth === 0`. These tests pin the
// replacement: a witch may run under a supervisor, and an expert receives its
// contract as an ordinary `user` message, so depth cannot decide either case.

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  AGENT_ROLE,
  EVENT_ORIGIN,
  classifyEventOrigin,
  resolveAgentRole,
  shouldDispatchExpert,
  shouldRunBroker,
  stampAgentRole,
  taskIdentity,
} from '../lib/agent-role.js'

/** A top-level witch session at depth 0. */
function witch(header = {}) {
  return {
    id: 'witch-1',
    options: {},
    session: { header: { id: 'sess-witch', delegationDepth: 0, ...header } },
  }
}

/** An expert session created by the dispatcher. */
function expert(header = {}) {
  return {
    id: 'expert-1',
    options: {},
    session: { header: { id: 'sess-expert', origin: 'subagent', parentSession: 'sess-witch', delegationDepth: 1, ...header } },
  }
}

const humanMessage = { id: 'msg-human', role: 'user', source: { kind: 'user' } }
const pluginMessage = { id: 'msg-plugin', role: 'user', source: { kind: 'plugin', plugin: 'witches-experts' } }
const toolMessage = { id: 'msg-tool', role: 'user', source: { kind: 'tool', callId: 'call-1' } }
const reportMessage = { id: 'msg-report', role: 'user', source: { kind: 'subagent-report', form: 'relay', senderSessionId: 'child' } }

test('a declared role wins over inference', () => {
  const declared = witch()
  declared.options = stampAgentRole({}, AGENT_ROLE.EXPERT)
  assert.equal(resolveAgentRole(declared), AGENT_ROLE.EXPERT)
  assert.equal(resolveAgentRole(witch()), AGENT_ROLE.WITCH)
  assert.equal(resolveAgentRole(expert()), AGENT_ROLE.EXPERT)
})

test('a witch under a supervisor is still a witch, not an expert', () => {
  // Depth says the chain is deep; it does not say what the session is for.
  const supervised = witch({ delegationDepth: 2, parentSession: 'sess-lead' })
  supervised.options = stampAgentRole({}, AGENT_ROLE.WITCH)
  assert.equal(resolveAgentRole(supervised), AGENT_ROLE.WITCH)
})

test('plugin and tool messages are never human, even with role user', () => {
  const agent = witch()
  assert.equal(classifyEventOrigin(pluginMessage, agent), EVENT_ORIGIN.SYSTEM)
  assert.equal(classifyEventOrigin(toolMessage, agent), EVENT_ORIGIN.TOOL)
  assert.equal(classifyEventOrigin(reportMessage, agent), EVENT_ORIGIN.DELEGATION)
})

test('a message handed down by a parent session is delegation', () => {
  const relayed = { id: 'msg-parent', role: 'user', source: { kind: 'user', parentSessionId: 'sess-parent' } }
  assert.equal(classifyEventOrigin(relayed, witch()), EVENT_ORIGIN.DELEGATION)
})

test("an expert's own contract is delegation, not human input", () => {
  // The child receives its prompt with the same `kind: 'user'` source a typed
  // message uses, so the session's role is what distinguishes them.
  assert.equal(classifyEventOrigin(humanMessage, expert()), EVENT_ORIGIN.DELEGATION)
  assert.equal(classifyEventOrigin(humanMessage, witch()), EVENT_ORIGIN.HUMAN)
})

test('the broker runs for one authentic human message on the witch only', () => {
  assert.equal(shouldRunBroker(humanMessage, witch()), true)
  // Delegated contract to an expert.
  assert.equal(shouldRunBroker(humanMessage, expert()), false)
  // Injected context never triggers a capsule.
  assert.equal(shouldRunBroker(pluginMessage, witch()), false)
  assert.equal(shouldRunBroker(toolMessage, witch()), false)
  assert.equal(shouldRunBroker(undefined, witch()), false)
})

test('the dispatcher belongs to the witch and refuses non-human input', () => {
  assert.equal(shouldDispatchExpert(humanMessage, witch()), true)
  assert.equal(shouldDispatchExpert(humanMessage, expert()), false)
  assert.equal(shouldDispatchExpert(pluginMessage, witch()), false)
  assert.equal(shouldDispatchExpert(reportMessage, witch()), false)
})

test('an expert may exist at depth 1 without being mistaken for a worker', () => {
  const worker = witch({ delegationDepth: 1 })
  worker.options = stampAgentRole({}, AGENT_ROLE.WORKER)
  assert.equal(resolveAgentRole(worker), AGENT_ROLE.WORKER)
  // A worker is not the human-facing session, so it never runs the broker.
  assert.equal(shouldRunBroker(humanMessage, worker), false)
})

test('task identity separates sessions and messages for dispatch deduplication', () => {
  const a = taskIdentity(humanMessage, witch())
  const b = taskIdentity(humanMessage, witch())
  assert.equal(a, b)
  const other = taskIdentity({ id: 'msg-other', role: 'user', source: { kind: 'user' } }, witch())
  assert.notEqual(a, other)
  const otherSession = taskIdentity(humanMessage, witch({ id: 'sess-other' }))
  assert.notEqual(a, otherSession)
})

test('the role vocabulary is closed and stable', () => {
  assert.deepEqual(Object.values(AGENT_ROLE).sort(), ['expert', 'witch', 'worker'])
  assert.deepEqual(Object.values(EVENT_ORIGIN).sort(), ['delegation', 'human', 'system', 'tool'])
})
