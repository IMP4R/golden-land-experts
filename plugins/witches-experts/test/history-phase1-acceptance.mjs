import { randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { AbstractApiClient } from '../../../packages/host/apiproxy/src/fetch/client.ts'

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:3280'
const OUT = process.env.HISTORY_PHASE1_OUT
const HOME = process.env.DSH_HOME
if (!OUT || !HOME) throw new Error('HISTORY_PHASE1_OUT and DSH_HOME are required')
class Client extends AbstractApiClient { resolveBase() { return BASE } doFetch(input, init) { return fetch(input, init) } }
const api = new Client(120_000)
const text = value => [{ type: 'text', text: value }]
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const result = { at: new Date().toISOString(), base: BASE, tests: {}, sessions: {} }
await mkdir(OUT, { recursive: true })

async function save(name, value) {
  await writeFile(`${OUT}/${name}.json`, `${JSON.stringify(value, null, 2)}\n`)
}
async function create(label) {
  const sessionId = `history-${label}-${randomUUID()}`
  const response = await api.sessions.create({ cwd: '/Users/user0/golden-land-new/dsh-witches-clone', sessionId, agentPreset: 'witches' })
  if (!response.result.ok) throw new Error(JSON.stringify(response))
  result.sessions[label] = sessionId
  return sessionId
}
async function history(sessionId) {
  const response = await api.sessions.history({ sessionId, maxMessages: 1000 })
  if (!response.result.ok) throw new Error(JSON.stringify(response))
  const value = response.result.value
  return { ...value, events: (value.events || []).map(entry => entry.event || entry) }
}
async function waitTurn(sessionId, beforeEndCount, timeout = 120_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const value = await history(sessionId)
    const events = value.events || []
    if (events.filter(event => event.type === 'turn/end').length > beforeEndCount) return value
    await sleep(250)
  }
  throw new Error(`turn timeout: ${sessionId}`)
}
async function prompt(sessionId, value) {
  const before = await history(sessionId)
  const beforeEnds = (before.events || []).filter(event => event.type === 'turn/end').length
  const response = await api.sessions.prompt({ sessionId, mode: 'queue', content: text(value), clientTimeZone: 'Europe/Moscow' })
  if (!response.result.ok) throw new Error(JSON.stringify(response))
  return { response: response.result.value, history: await waitTurn(sessionId, beforeEnds) }
}
function toolResults(value, toolName) {
  return (value.events || []).filter(event => event.type === 'tool/result' && event.data?.message?.source?.toolName === toolName)
}
function parseTool(event) {
  const body = (event?.data?.message?.content || []).flatMap(block => block?.content || []).find(block => block?.type === 'text')?.text
  try { return JSON.parse(body) } catch { return { raw: body } }
}
async function journal() {
  const raw = await readFile(`${HOME}/memory/history/events.jsonl`, 'utf8').catch(() => '')
  return raw.split('\n').filter(Boolean).map(line => JSON.parse(line))
}

const marker = `EARLY_HISTORY_MARKER_${randomUUID().replaceAll('-', '').slice(0, 12)}`
const a = await create('A')
await prompt(a, `${marker}. Запомни маркер, ответь только OK.`)
await prompt(a, Array.from({ length: 12 }, (_, i) => `NOISE_EVENT_${i + 1}`).join('\n'))
const searchRun = await prompt(a, `Обязательно вызови history_search с query ${marker} и limit 10. После результата ответь одной строкой.`)
const searchEvents = toolResults(searchRun.history, 'history_search')
const searchValue = parseTool(searchEvents.at(-1))
const hit = searchValue.hits?.find(row => row.summary?.includes(marker))
const afterSearchJournal = await journal()
result.tests.early_search = {
  marker, session_id: a, event_count_before_search: afterSearchJournal.filter(row => row.session_id === a).length,
  tool_result: searchValue, pass: Boolean(hit) && afterSearchJournal.filter(row => row.session_id === a).length >= 10,
}
await save('01-early-search', result.tests.early_search)

const own = afterSearchJournal.filter(row => row.session_id === a && row.type === 'human_message')
const start = own[0]
const end = own[Math.min(2, own.length - 1)]
const rangeRun = await prompt(a, `Обязательно вызови history_read с event_id ${start.event_id} и range {"end_event_id":"${end.event_id}"}. Не пересказывай результат.`)
const rangeValue = parseTool(toolResults(rangeRun.history, 'history_read').at(-1))
result.tests.range = { start: start.event_id, end: end.event_id, expected: afterSearchJournal.slice(afterSearchJournal.indexOf(start), afterSearchJournal.indexOf(end) + 1).filter(row => row.privacy_scope === `witch:${a}`).map(row => row.event_id), actual: rangeValue.events?.map(row => row.event_id), pass: false }
result.tests.range.pass = JSON.stringify(result.tests.range.actual) === JSON.stringify(result.tests.range.expected)
await save('02-range', result.tests.range)

const b = await create('B')
const privacyRun = await prompt(b, `Обязательно вызови history_read с event_id ${start.event_id}. Это negative privacy test; затем ответь DONE.`)
const privacyValue = parseTool(toolResults(privacyRun.history, 'history_read').at(-1))
result.tests.privacy = { session_a: a, session_b: b, event_id: start.event_id, tool_result: privacyValue, level: 'black-box real clone tool call from witch B', pass: Array.isArray(privacyValue.events) && privacyValue.events.length === 0 }
await save('03-privacy', result.tests.privacy)

const beforeCancel = (await history(a)).events?.filter(event => event.type === 'turn/end').length || 0
await api.sessions.prompt({ sessionId: a, mode: 'queue', content: text(`CANCEL_TARGET_${marker} ${'long '.repeat(3000)}`), clientTimeZone: 'Europe/Moscow' })
await sleep(50)
await api.sessions.cancel({ sessionId: a })
await waitTurn(a, beforeCancel).catch(() => undefined)
await sleep(500)
const cancelledJournal = await journal()
const cancellation = [...cancelledJournal].reverse().find(row => row.session_id === a && row.type === 'cancellation')
const target = cancellation && cancelledJournal.find(row => row.event_id === cancellation.parent_event)
const cancelSearch = target ? await prompt(a, `Обязательно вызови history_search с query ${target.summary.slice(0, 40)}. Ответь DONE.`) : null
const cancelValue = cancelSearch ? parseTool(toolResults(cancelSearch.history, 'history_search').at(-1)) : {}
const cancelHit = cancelValue.hits?.find(row => row.event_id === target?.event_id)
result.tests.cancellation = { cancellation, target, search_hit: cancelHit, pass: Boolean(cancellation && target && cancelHit?.cancelled === true && cancelHit?.active === false) }
await save('04-cancellation', result.tests.cancellation)

const rawMarker = `COMPACT_RAW_${randomUUID().replaceAll('-', '').slice(0, 10)}`
await prompt(a, `${rawMarker}: durable raw text before compaction. Constraint: preserve only a short summary after compact.`)
await prompt(a, Array.from({ length: 24 }, (_, i) => `COMPACT_NOISE_${i}: ${'state detail '.repeat(30)}`).join('\n'))
const compactResponse = await api.sessions.prompt({ sessionId: a, mode: 'queue', content: text('/compact'), clientTimeZone: 'Europe/Moscow' })
await sleep(1000)
const compactJournal = await journal()
const rawEvent = compactJournal.find(row => row.session_id === a && row.type === 'human_message' && row.summary.includes(rawMarker))
const checkpoint = [...compactJournal].reverse().find(row => row.session_id === a && row.type === 'checkpoint')
const continueRun = await prompt(a, 'продолжай')
const traceRaw = await readFile(`${HOME}/memory/broker-trace.jsonl`, 'utf8').catch(() => '')
const trace = traceRaw.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
const brokerRequest = [...trace].reverse().find(row => row.kind === 'broker-request' && row.history)
const brokerTexts = brokerRequest?.history?.map(row => row.text || '') || []
result.tests.compaction = { raw_marker: rawMarker, command: compactResponse.result, raw_event: rawEvent, checkpoint, broker_request_history: brokerRequest?.history, pass: Boolean(rawEvent && checkpoint && !brokerTexts.some(value => value.includes(rawMarker)) && brokerTexts.some(value => value.includes('<compacted-summary>'))) }
await save('05-compaction', result.tests.compaction)

result.restart = { session_id: a, marker, event_id: hit?.event_id || null, pending: true }
await save('restart-pending', result.restart)
await save('driver-summary', result)
console.log(JSON.stringify(result, null, 2))
