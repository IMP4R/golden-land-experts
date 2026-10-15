import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '../../../vendor/cordis/lib/index.js'
import test from 'node:test'
import { PersistentCodeRuntime } from '../../../packages/code-runtime/code-runtime-persistent/src/index.ts'
import { DurableHistory } from '../lib/history.js'
import { RlmJournal } from '../lib/rlm.js'
import { createRlmCodeBindings } from '../lib/rlm-code.js'
import { registerRlm } from '../lib/rlm.js'

async function fixture(t, limits = {}) {
  const root = await mkdtemp(join(tmpdir(), 'witch-rlm-code-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const history = new DurableHistory(join(root, 'history'))
  const journal = new RlmJournal(join(root, 'rlm'))
  const runtime = new PersistentCodeRuntime(new Context(), { runTimeoutMs: 20_000 })
  t.after(async () => runtime.dispose())
  await journal.ready
  return { history, journal, runtime, limits }
}

function bind(runtime, history, journal, sessionId, expertCalls = [], limits = {}) {
  const exec = { session: { id: sessionId }, agent: { id: `agent-${sessionId}`, session: { id: sessionId }, options: {} }, signal: new AbortController().signal }
  const rlm = createRlmCodeBindings({
    history, journal, limits,
    experts: [{ id: 'repo-audit', title: 'Repository Audit', scope: 'repository' }],
    spawnExpert: async (_exec, expert, contract, context) => {
      expertCalls.push({ expert, contract, context, sessionId })
      return { id: `run-${expertCalls.length}` }
    },
  })
  return [{ global: 'rlm', functions: Object.fromEntries(Object.entries(rlm.namespace.functions).map(([name, fn]) => [name, args => fn(args, exec)])) }]
}

test('Code Mode can search early history and retain the prompt-as-variable namespace across programs', async t => {
  const { history, journal, runtime } = await fixture(t)
  const early = await history.append({ session_id: 'A', actor: 'human', role: 'user', type: 'human_message', summary: 'EARLY_RLM_CODE_MARKER', raw: 'EARLY_RLM_CODE_MARKER', privacy_scope: 'witch:A' })
  const bindings = bind(runtime, history, journal, 'A')
  const first = await runtime.run({ program: `result = await rlm.search({"query":"EARLY_RLM_CODE_MARKER"})\nprint(result["items"][0]["event_id"])\ncontext = {"event_id": result["items"][0]["event_id"]}\ncontext["event_id"]`, bindings })
  assert.equal(first.error, undefined)
  assert.equal(first.value, early.event_id)
  const second = await runtime.run({ program: 'context["event_id"]', bindings })
  assert.equal(second.value, early.event_id)
  assert.equal((await journal.list('A')).at(-1).kind, 'rlm.code.search')
})

test('program code can spawn a shared expert with durable cited context', async t => {
  const { history, journal, runtime } = await fixture(t)
  const source = await history.append({ session_id: 'A', actor: 'human', role: 'user', type: 'human_message', summary: 'source detail marker', raw: 'source detail marker', privacy_scope: 'witch:A' })
  const calls = []
  const bindings = bind(runtime, history, journal, 'A', calls)
  const result = await runtime.run({ program: `await rlm.spawn({"expert_id":"repo-audit","goal":"inspect","scope":"repository","acceptance":"cite files","source_event_ids":["${source.event_id}"]})`, bindings })
  assert.equal(result.error, undefined)
  assert.equal(result.value.expert_id, 'repo-audit')
  assert.deepEqual(calls[0].contract.source_event_ids, [source.event_id])
  assert.match(calls[0].context, new RegExp(source.event_id))
  assert.equal((await journal.list('A')).at(-1).kind, 'rlm.code.spawn')
})

test('lookup budget counts across Code Mode runs and does not journal rejected excess', async t => {
  const { history, journal, runtime } = await fixture(t)
  await history.append({ session_id: 'A', actor: 'human', role: 'user', type: 'human_message', summary: 'budget marker', raw: 'budget marker', privacy_scope: 'witch:A' })
  const bindings = bind(runtime, history, journal, 'A', [], { maxLookups: 1 })
  assert.equal((await runtime.run({ program: 'await rlm.search({"query":"budget"})', bindings })).error, undefined)
  const denied = await runtime.run({ program: 'await rlm.search({"query":"budget"})', bindings })
  assert.match(denied.error.message, /lookup budget exceeded/)
  assert.equal((await journal.list('A')).filter(row => row.kind === 'rlm.code.search').length, 1)
})

test('RLM host plugin contributes Code Mode namespace and disposes it', async t => {
  const { history, journal } = await fixture(t)
  const registrations = []
  let extension
  const ctx = {
    tools: {
      extendCodeMode: options => { extension = options; return () => { extension = undefined } },
      register: definition => { registrations.push(definition); return () => {} },
    },
    effect: setup => setup(),
  }
  const registered = registerRlm(ctx, { history, journal, nativeTools: false, experts: [] })
  assert.equal(registrations.length, 0)
  assert.equal(extension.extraBindings({ id: 'A', session: { id: 'A' } })[0].global, 'rlm')
  assert.match(extension.extraSdk()[0], /rlm.spawn/)
  registered.dispose()
  assert.equal(extension, undefined)
})

test('journal rehydrates lookup count after runtime restart', async t => {
  const { history, journal, runtime } = await fixture(t, { maxLookups: 1 })
  await history.append({ session_id: 'A', actor: 'human', role: 'user', type: 'human_message', summary: 'restart marker', raw: 'restart marker', privacy_scope: 'witch:A' })
  const bindings = bind(runtime, history, journal, 'A', [], { maxLookups: 1 })
  assert.equal((await runtime.run({ program: 'await rlm.search({"query":"restart"})', bindings })).error, undefined)
  await runtime.dispose()
  const afterRestart = new PersistentCodeRuntime(new Context(), { runTimeoutMs: 20_000 })
  t.after(async () => afterRestart.dispose())
  const reloadedJournal = new RlmJournal(journal.root)
  await reloadedJournal.ready
  const denied = await afterRestart.run({ program: 'await rlm.search({"query":"restart"})', bindings: bind(afterRestart, history, reloadedJournal, 'A', [], { maxLookups: 1 }) })
  assert.match(denied.error.message, /lookup budget exceeded/)
})
