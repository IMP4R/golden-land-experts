import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DurableHistory } from '../lib/history.js'
import { createRlmReader, registerRlm, RlmJournal } from '../lib/rlm.js'

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'witch-rlm-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return { root, history: new DurableHistory(join(root, 'history')), journal: new RlmJournal(join(root, 'rlm')) }
}

function event(session, summary, privacy = `witch:${session}`) {
  return { session_id: session, actor: 'human', role: 'user', type: 'human_message', summary, raw: summary, privacy_scope: privacy }
}

test('RLM search finds early marker after noisy history and returns event provenance', async t => {
  const { history, journal } = await fixture(t)
  const early = await history.append(event('A', 'EARLY_RLM_MARKER_X9'))
  for (let index = 0; index < 12; index += 1) await history.append(event('A', `noise event ${index}`))
  const reader = createRlmReader(history, 'A', journal)
  const hits = await reader.search('EARLY_RLM_MARKER_X9')
  assert.equal(hits.events[0].event_id, early.event_id)
  assert.equal(reader.lookupCount, 1)
  const journalRows = await journal.list('A')
  assert.deepEqual(journalRows[0].source_event_ids, [early.event_id])
})

test('RLM range lookup returns exact ordered source events', async t => {
  const { history, journal } = await fixture(t)
  const first = await history.append(event('A', 'range alpha'))
  await history.append(event('A', 'range beta'))
  const last = await history.append(event('A', 'range gamma'))
  const reader = createRlmReader(history, 'A', journal)
  const result = await reader.read(first.event_id, last.event_id)
  const events = result.events
  assert.deepEqual(events.map(item => item.summary), ['range alpha', 'range beta', 'range gamma'])
  assert.deepEqual((await journal.list('A'))[0].source_event_ids, events.map(item => item.event_id))
})

test('RLM enforces lookup count and output size limits', async t => {
  const { history, journal } = await fixture(t)
  await history.append(event('A', 'bounded marker'))
  const reader = createRlmReader(history, 'A', journal, { maxLookups: 1, maxChars: 200 })
  await reader.search('bounded')
  await assert.rejects(reader.search('bounded'), /lookup limit reached/)
  assert.equal(reader.lookupCount, 1)
  const oneResult = await createRlmReader(history, 'A', journal, { maxChars: 200 }).read((await history.search('A', 'bounded'))[0].event_id)
  assert.equal(oneResult.events.length, 0)
  assert.equal(oneResult.truncated, true)
})

test('RLM search does not expose another witch private scope', async t => {
  const { history, journal } = await fixture(t)
  await history.append(event('A', 'PRIVATE_SCOPE_MARKER'))
  const reader = createRlmReader(history, 'B', journal)
  assert.deepEqual((await reader.search('PRIVATE_SCOPE_MARKER')).events, [])
})

test('rlm_spawn starts the named expert from a bounded context variable and journals the programmatic call', async t => {
  const { history, journal } = await fixture(t)
  const evidence = await history.append(event('A', 'source detail marker'))
  history.experts = [{ id: 'repo-audit', title: 'Repository Audit', scope: 'repository' }]
  history.expertRoute = async () => ({ resolvedProvider: 'provider-cheap', resolvedModel: 'model-cheap' })
  const started = []
  const ctx = {
    tools: { register: spec => { started.push({ tool: spec.name, execute: spec.execute }); return () => {} } },
    effect: fn => fn(),
    subagents: { start: async (provider, request) => { started.push({ provider, request }); return { id: 'run-1' } } },
  }
  const registered = registerRlm(ctx, { history, journal, limits: { maxChars: 2000 } })
  const tool = started.find(row => row.tool === 'rlm_spawn')
  assert.ok(tool)
  const result = await tool.execute({ expert_id: 'repo-audit', goal: 'inspect repository', scope: 'repository', acceptance: 'cite paths', source_event_ids: [evidence.event_id] }, { agent: { id: 'agent-A', session: { id: 'A' } }, signal: new AbortController().signal })
  assert.equal(result.ok, true)
  const call = started.find(row => row.provider === 'spawn')
  assert.equal(call.request.parent.session.id, 'A')
  assert.match(call.request.prompt[0].text, /Context variable/)
  assert.match(call.request.prompt[0].text, new RegExp(evidence.event_id))
  assert.equal(call.request.agentOptions.provider, 'provider-cheap')
  assert.equal(call.request.agentOptions.model, 'model-cheap')
  assert.ok(call.request.toolFilter.deny.includes('rlm_spawn'))
  const persisted = await journal.list('A')
  assert.equal(persisted.at(-1).kind, 'rlm.spawn')
  assert.deepEqual(persisted.at(-1).source_event_ids, [evidence.event_id])
  registered.dispose()
})
