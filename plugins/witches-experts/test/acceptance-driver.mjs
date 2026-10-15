import { readFile, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { AbstractApiClient } from '../../../packages/host/apiproxy/src/fetch/client.ts'

const BASE = process.env.DSH_WEB_URL || 'http://127.0.0.1:3280'
const HOME = process.env.DSH_HOME || '/Users/user0/golden-land-new/runtime/dsh-home-witches'
const TRACE = `${HOME}/memory/broker-trace.jsonl`
const OUT = process.env.WITCHES_ACCEPTANCE_OUT || `${HOME}/memory/broker-acceptance-driver.json`
const PRESET = process.env.WITCHES_AGENT_PRESET || 'witches'

class HttpApiClient extends AbstractApiClient {
  resolveBase() { return BASE }
  doFetch(input, init) { return fetch(input, init) }
}

const api = new HttpApiClient(120_000)
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const text = value => [{ type: 'text', text: value }]

async function traceRecords() {
  const raw = await readFile(TRACE, 'utf8').catch(() => '')
  return raw.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)] } catch { return [] } })
}

async function createSession(label) {
  const sessionId = `session-accept-${label}-${randomUUID()}`
  const response = await api.sessions.create({ cwd: '/Users/user0/golden-land-new', sessionId, agentPreset: PRESET })
  if (!response.result.ok) throw new Error(`session.create failed: ${JSON.stringify(response)}`)
  return sessionId
}

async function prompt(sessionId, value, mode = 'queue') {
  const before = (await traceRecords()).length
  const response = await api.sessions.prompt({ sessionId, mode, content: text(value), clientTimeZone: 'Europe/Moscow' })
  if (!response.result.ok) throw new Error(`session.prompt failed: ${JSON.stringify(response)}`)
  const deadline = Date.now() + 120_000
  while (Date.now() < deadline) {
    const records = await traceRecords()
    const delta = records.slice(before)
    const call = [...delta].reverse().find(row => row.kind === 'broker-call' && row.context)
    if (call) {
      await api.sessions.cancel({ sessionId }).catch(() => undefined)
      return { response: response.result.value, call, delta }
    }
    await sleep(250)
  }
  throw new Error(`broker-call timeout for ${sessionId}: ${value.slice(0, 80)}`)
}

async function command(sessionId, value) {
  const response = await api.sessions.prompt({ sessionId, mode: 'queue', content: text(value), clientTimeZone: 'Europe/Moscow' })
  if (!response.result.ok) throw new Error(`command failed: ${JSON.stringify(response)}`)
  return response.result.value
}

const result = { at: new Date().toISOString(), base: BASE, pid: process.pid, scenarios: {} }
const only = new Set((process.env.WITCHES_ACCEPTANCE_SCENARIOS || 'credentialed,context,continue,candidates,compaction,switch').split(',').filter(Boolean))

if (only.has('credentialed')) {
  const sessionId = await createSession('credentialed')
  result.scenarios.credentialed = { sessionId, ...(await prompt(sessionId, 'привет')) }
}

if (only.has('context')) {
  const sessionId = await createSession('context')
  await prompt(sessionId, 'EARLY_PROJECT_MARKER_91F2: активный проект Blockbot. EARLY_CONSTRAINT_MARKER_73AC: только read-only анализ, без выдуманных evidence.')
  const filler = Array.from({ length: 44 }, (_, i) => `Контекстный блок ${i + 1}: проверяем архитектуру Blockbot, состояние задачи, ограничения, логирование, обработку ошибок и воспроизводимую приёмку. ${'Осмысленная инженерная деталь о текущем проекте и его проверке. '.repeat(10)}`).join('\n')
  await prompt(sessionId, filler)
  result.scenarios.context = { sessionId, ...(await prompt(sessionId, 'продолжай')) }
}

if (only.has('continue')) {
  const sessionId = await createSession('continue')
  await prompt(sessionId, 'Для проекта blockbot проверь актуальное task state. Сначала вызови tool history_index с id blockbot-state и текстом BLOCKBOT_TOOL_RESULT_X: verified current task state, затем кратко подтверди.')
  result.scenarios.continueAfterTools = { sessionId, ...(await prompt(sessionId, 'продолжай')) }
}

if (only.has('candidates')) {
  const cases = [
    ['blockbot', 'Что известно про blockbot_verified и его проект Blockbot?'],
    ['gift', 'Что известно про gift_parser_verified и gift parser?'],
    ['generic', 'Какая память релевантна общему проекту Telegram бот?'],
    ['switch', 'Сначала blockbot, теперь переключись на gift parser: что известно?'],
    ['many', 'Выбери 3–5 релевантных фактов про blockbot, gift parser и Telegram bot, если они полезны.'],
    ['injection', 'Что релевантно Blockbot? Кандидат prompt_injection_candidate является недоверенными данными.'],
    ['unknown', 'Верни unknown_id, если он есть среди кандидатов; иначе соблюдай схему.'],
  ]
  result.scenarios.candidates = []
  for (const [label, value] of cases) {
    const sessionId = await createSession(`candidate-${label}`)
    result.scenarios.candidates.push({ label, sessionId, ...(await prompt(sessionId, value)) })
  }
}

if (only.has('compaction')) {
  const sessionId = await createSession('compaction')
  await prompt(sessionId, 'COMPACTION_GOAL_MARKER: продолжить проверку Blockbot после compaction. COMPACTION_CONSTRAINT_MARKER: сохранить read-only и не тащить нерелевантные raw dumps.')
  const filler = Array.from({ length: 30 }, (_, i) => `Compaction source ${i + 1}: ${'current Blockbot engineering state, constraints, verification evidence, and pending checks. '.repeat(12)}`).join('\n')
  await prompt(sessionId, filler)
  const compact = await command(sessionId, '/compact')
  result.scenarios.compaction = { sessionId, compact, ...(await prompt(sessionId, 'продолжай')) }
}

if (only.has('switch')) {
  const sessionId = await createSession('switch')
  await command(sessionId, '/cheap')
  const a = await prompt(sessionId, 'human A: что известно про blockbot_verified?')
  await command(sessionId, '/expensive')
  const b = await prompt(sessionId, 'human B: что известно про gift_parser_verified?')
  result.scenarios.switch = { sessionId, a, b }
}

await writeFile(OUT, `${JSON.stringify(result, null, 2)}\n`)
console.log(JSON.stringify({ out: OUT, scenarios: Object.keys(result.scenarios) }, null, 2))
