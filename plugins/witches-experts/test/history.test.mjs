import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { DurableHistory } from '../lib/history.js'

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'witch-history-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return { dir, store: new DurableHistory(dir) }
}

function event(session, summary, extra = {}) {
  return {
    session_id: session,
    actor: 'human',
    role: 'user',
    type: 'human_message',
    summary,
    raw: summary,
    privacy_scope: `witch:${session}`,
    ...extra,
  }
}

test('persists schema fields and restores search after restart', async (t) => {
  const { dir, store } = await fixture(t)
  const written = await store.append(event('A', 'EARLY_HISTORY_MARKER_UNIT'))
  assert.match(written.event_id, /^evt-/)
  assert.equal(written.cancelled, false)
  const restored = new DurableHistory(dir)
  const hits = await restored.search('A', 'EARLY_HISTORY_MARKER_UNIT')
  assert.equal(hits[0].event_id, written.event_id)
  const rows = await restored.read('A', written.event_id)
  assert.equal(rows[0].artifact_contents[0].content, 'EARLY_HISTORY_MARKER_UNIT')
})

test('filters another witch private scope from search, direct read, range, and artifact', async (t) => {
  const { store } = await fixture(t)
  const secret = await store.append(event('A', 'PRIVATE_A_SECRET'))
  const visible = await store.append(event('B', 'VISIBLE_B'))
  assert.deepEqual(await store.search('B', 'PRIVATE_A_SECRET'), [])
  assert.deepEqual(await store.read('B', secret.event_id), [])
  assert.deepEqual(await store.read('B', secret.event_id, visible.event_id), [{
    ...(await store.read('B', visible.event_id))[0],
  }])
  assert.equal(await store.readArtifact('B', secret.artifact_refs[0]), null)
})

test('inclusive range preserves exact journal order', async (t) => {
  const { store } = await fixture(t)
  const first = await store.append(event('A', 'range-first'))
  await store.append(event('A', 'range-middle'))
  const last = await store.append(event('A', 'range-last'))
  const rows = await store.read('A', first.event_id, last.event_id)
  assert.deepEqual(rows.map(row => row.summary), ['range-first', 'range-middle', 'range-last'])
})

test('cancellation retains target and marks it inactive', async (t) => {
  const { store } = await fixture(t)
  const target = await store.append(event('A', 'CANCEL_ME'))
  const cancellation = await store.append({
    session_id: 'A', actor: 'system', role: 'system', type: 'cancellation',
    summary: 'cancel target', parent_event: target.event_id, privacy_scope: 'witch:A',
  })
  const hits = await store.search('A', 'CANCEL_ME')
  assert.equal(hits[0].cancelled, true)
  assert.equal(hits[0].active, false)
  assert.equal((await store.read('A', target.event_id))[0].cancelled, true)
  assert.equal((await store.read('A', cancellation.event_id))[0].type, 'cancellation')
})

test('runtime compaction and error events map to durable types', async (t) => {
  const { store } = await fixture(t)
  await store.append({ session_id: 'A', actor: 'system', role: 'system', type: 'compaction', summary: 'compaction/summary cmp-1', raw: '{"compactionId":"cmp-1"}', privacy_scope: 'witch:A' })
  await store.append({ session_id: 'A', actor: 'system', role: 'system', type: 'error', summary: 'provider failed', raw: '{"code":"ERR"}', privacy_scope: 'witch:A' })
  assert.equal((await store.search('A', 'cmp-1'))[0].type, 'compaction')
  assert.equal((await store.search('A', 'provider failed'))[0].type, 'error')
})

test('search defaults to ten and caps requested limit at fifty', async (t) => {
  const { store } = await fixture(t)
  for (let index = 0; index < 60; index += 1) await store.append(event('A', `noise common ${index}`))
  assert.equal((await store.search('A', 'common')).length, 10)
  assert.equal((await store.search('A', 'common', undefined, 999)).length, 50)
})
