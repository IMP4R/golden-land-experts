import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const EVENT_TYPES = new Set([
  'human_message', 'assistant_decision', 'tool_call', 'tool_result', 'expert_contract',
  'expert_result', 'checkpoint', 'compaction', 'error', 'cancellation',
])
const SEARCH_DEFAULT = 10
const SEARCH_MAX = 50
const SUMMARY_MAX = 280
const READ_MAX = 200

function dshHome() {
  return process.env.DSH_HOME || join(process.cwd(), 'runtime', 'dsh-home-witches')
}

function textBlocks(message) {
  return (message?.content || [])
    .filter(block => block?.type === 'text')
    .map(block => String(block.text || ''))
    .join('\n')
}

function clipped(value, max = SUMMARY_MAX) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`
}

function eventId() {
  return `evt-${Date.now().toString(36)}-${randomUUID().replaceAll('-', '').slice(0, 18)}`
}

function artifactId(sessionId, eventType, content) {
  const digest = createHash('sha256').update(`${sessionId}\0${eventType}\0${content}`).digest('hex').slice(0, 24)
  return `artifact-${digest}`
}

function privacyAllows(event, callerSessionId) {
  return event.privacy_scope === 'shared' || event.privacy_scope === `witch:${callerSessionId}`
}

function normalizedLimit(value) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed)) return SEARCH_DEFAULT
  return Math.max(1, Math.min(SEARCH_MAX, Math.trunc(parsed)))
}

function eventFromSession(session, runtimeEvent) {
  const sessionId = String(session.id)
  const base = {
    session_id: sessionId,
    parent_event: null,
    timestamp: new Date(Number(runtimeEvent.time) || Date.now()).toISOString(),
    artifact_refs: [],
    privacy_scope: `witch:${sessionId}`,
    cancelled: false,
  }
  const data = runtimeEvent.data || {}
  if (runtimeEvent.type === 'user/message') {
    const source = data.source || {}
    const raw = textBlocks(data)
    if (source.kind === 'plugin' && source.plugin === 'compact') {
      return { ...base, actor: 'system', role: 'system', type: 'checkpoint', summary: clipped(raw || 'Compaction checkpoint'), raw }
    }
    if (source.kind === 'user') return { ...base, actor: 'human', role: 'user', type: 'human_message', summary: clipped(raw), raw }
    return { ...base, actor: source.plugin ? `tool:${source.plugin}` : 'system', role: 'system', type: 'assistant_decision', summary: clipped(raw), raw }
  }
  if (runtimeEvent.type === 'assistant/message') {
    const raw = textBlocks(data.message)
    return { ...base, actor: 'witch', role: 'assistant', type: 'assistant_decision', summary: clipped(raw), raw }
  }
  if (runtimeEvent.type === 'tool/call') {
    const raw = String(data.arguments || '')
    return { ...base, actor: `tool:${String(data.name || 'unknown')}`, role: 'tool', type: data.name === 'expert_ask' ? 'expert_contract' : 'tool_call', summary: clipped(`${data.name || 'tool'} ${raw}`), raw }
  }
  if (runtimeEvent.type === 'tool/result') {
    const name = data.message?.source?.toolName || data.message?.source?.name || 'unknown'
    const raw = textBlocks(data.message)
    const failed = Boolean(data.error)
    return { ...base, actor: `tool:${String(name)}`, role: 'tool', type: failed ? 'error' : name === 'expert_ask' ? 'expert_result' : 'tool_result', summary: clipped(`${name}: ${raw || data.error?.message || ''}`), raw }
  }
  if (runtimeEvent.type.startsWith('compaction/')) {
    return { ...base, actor: 'system', role: 'system', type: 'compaction', summary: clipped(`${runtimeEvent.type} ${data.compactionId || ''}`), raw: JSON.stringify(data) }
  }
  if (runtimeEvent.type === 'turn/end' && ['aborted', 'interrupted'].includes(data.reason?.kind)) {
    return { ...base, actor: 'system', role: 'system', type: 'cancellation', summary: clipped(`Turn ${data.turn || ''} ${data.reason.kind}`), raw: JSON.stringify(data.reason) }
  }
  if (runtimeEvent.type === 'turn/end' && data.reason?.kind === 'error') {
    return { ...base, actor: 'system', role: 'system', type: 'error', summary: clipped(data.reason.error?.message || 'Turn error'), raw: JSON.stringify(data.reason) }
  }
  return null
}

export class DurableHistory {
  constructor(root = join(dshHome(), 'memory', 'history')) {
    this.root = root
    this.eventsPath = join(root, 'events.jsonl')
    this.artifactsDir = join(root, 'artifacts')
    this.events = []
    this.byId = new Map()
    this.writeChain = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    await mkdir(this.artifactsDir, { recursive: true })
    let raw = ''
    try { raw = await readFile(this.eventsPath, 'utf8') } catch { return }
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue
      try {
        const event = JSON.parse(line)
        if (event?.event_id && EVENT_TYPES.has(event.type)) {
          this.events.push(event)
          this.byId.set(event.event_id, event)
        }
      } catch { /* a torn final line is ignored; earlier append-only records remain readable */ }
    }
  }

  async artifactContent(id) {
    try { return await readFile(join(this.artifactsDir, `${id}.txt`), 'utf8') } catch { return null }
  }

  async append(input) {
    await this.ready
    const event = {
      event_id: eventId(),
      session_id: String(input.session_id),
      actor: String(input.actor),
      role: String(input.role),
      parent_event: input.parent_event || null,
      timestamp: input.timestamp || new Date().toISOString(),
      type: input.type,
      summary: clipped(input.summary),
      artifact_refs: [],
      privacy_scope: input.privacy_scope || `witch:${String(input.session_id)}`,
      cancelled: Boolean(input.cancelled),
    }
    if (!EVENT_TYPES.has(event.type)) throw new Error(`unsupported history event type: ${event.type}`)
    const raw = String(input.raw || '')
    const artifact = raw ? artifactId(event.session_id, event.type, raw) : null
    if (artifact) event.artifact_refs.push(artifact)
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.eventsPath), { recursive: true })
      if (artifact) await writeFile(join(this.artifactsDir, `${artifact}.txt`), raw, { flag: 'wx' }).catch(error => {
        if (error?.code !== 'EEXIST') throw error
      })
      await writeFile(this.eventsPath, `${JSON.stringify(event)}\n`, { flag: 'a' })
      this.events.push(event)
      this.byId.set(event.event_id, event)
    })
    await this.writeChain
    return event
  }

  cancellationTargets() {
    const targets = new Set()
    for (const event of this.events) if (event.type === 'cancellation' && event.parent_event) targets.add(event.parent_event)
    return targets
  }

  async search(callerSessionId, query, scope, limit) {
    await this.ready
    await this.writeChain
    const needle = String(query || '').trim().toLowerCase()
    if (!needle) return []
    const cancelled = this.cancellationTargets()
    const hits = []
    for (const event of this.events) {
      if (!privacyAllows(event, callerSessionId)) continue
      if (scope && event.privacy_scope !== scope) continue
      let haystack = `${event.summary}\n${event.type}\n${event.actor}`.toLowerCase()
      for (const id of event.artifact_refs) haystack += `\n${String(await this.artifactContent(id) || '').toLowerCase()}`
      if (!haystack.includes(needle)) continue
      hits.push({
        event_id: event.event_id,
        timestamp: event.timestamp,
        type: event.type,
        summary: event.summary,
        privacy_scope: event.privacy_scope,
        cancelled: event.cancelled || cancelled.has(event.event_id),
        active: !(event.cancelled || cancelled.has(event.event_id)),
      })
      if (hits.length >= normalizedLimit(limit)) break
    }
    return hits
  }

  async read(callerSessionId, eventIdOrStart, endEventId) {
    await this.ready
    await this.writeChain
    const start = this.events.findIndex(event => event.event_id === eventIdOrStart)
    if (start < 0) return []
    let end = start
    if (endEventId) {
      end = this.events.findIndex((event, index) => index >= start && event.event_id === endEventId)
      if (end < 0) return []
    }
    const cancelled = this.cancellationTargets()
    const result = []
    for (const event of this.events.slice(start, Math.min(end + 1, start + READ_MAX))) {
      if (!privacyAllows(event, callerSessionId)) continue
      const artifact_contents = []
      for (const id of event.artifact_refs) artifact_contents.push({ artifact_id: id, content: await this.artifactContent(id) })
      result.push({ ...event, cancelled: event.cancelled || cancelled.has(event.event_id), active: !(event.cancelled || cancelled.has(event.event_id)), artifact_contents })
    }
    return result
  }

  async readArtifact(callerSessionId, id) {
    await this.ready
    await this.writeChain
    const owner = this.events.find(event => event.artifact_refs.includes(id))
    if (!owner || !privacyAllows(owner, callerSessionId)) return null
    return this.artifactContent(id)
  }
}

export function registerDurableHistory(ctx, store = new DurableHistory()) {
  const eventIdsBySession = new Map()
  const lastActiveBySession = new Map()
  store.experts = store.experts || []
  store.expertRoute = store.expertRoute || null
  const seenRuntimeEvents = new Set()
  const remember = async (session, runtimeEvent) => {
    const runtimeKey = `${String(session.id)}:${String(runtimeEvent.seq)}`
    if (seenRuntimeEvents.has(runtimeKey)) return
    seenRuntimeEvents.add(runtimeKey)
    const mapped = eventFromSession(session, runtimeEvent)
    if (!mapped) return
    const keys = eventIdsBySession.get(mapped.session_id) || new Map()
    const data = runtimeEvent.data || {}
    const correlation = data.callId || data.message?.source?.callId || data.id || data.message?.id
    if (correlation && keys.has(String(correlation))) mapped.parent_event = keys.get(String(correlation))
    if (mapped.type === 'cancellation') mapped.parent_event = lastActiveBySession.get(mapped.session_id) || null
    const written = await store.append(mapped)
    if (correlation) keys.set(String(correlation), written.event_id)
    eventIdsBySession.set(mapped.session_id, keys)
    if (written.type !== 'cancellation') lastActiveBySession.set(mapped.session_id, written.event_id)
  }
  const seed = session => { for (const runtimeEvent of session.events || []) void remember(session, runtimeEvent) }
  for (const session of ctx.sessions?.list?.() || []) seed(session)
  ctx.on('session/created', seed)
  ctx.on('session/event', (session, runtimeEvent) => { void remember(session, runtimeEvent) })
  ctx.on('session/flush', async () => { await store.ready; await store.writeChain })
  const sessionIdOf = exec => String(exec?.agent?.session?.id || exec?.agent?.id || '')
  const output = {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
  ctx.effect(() => ctx.tools.register({
    name: 'history_search',
    description: 'Search the caller witch journal. Returns short matching fragments and event ids, never the full archive.',
    parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, scope: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    output,
    execute: async (args, exec) => ({ hits: await store.search(sessionIdOf(exec), args.query, args.scope, args.limit) }),
  }), 'witches-experts: durable history_search')
  ctx.effect(() => ctx.tools.register({
    name: 'history_read',
    description: 'Read one exact authorized history event or an inclusive event-id range. Large payloads are returned from referenced artifacts.',
    parameters: { type: 'object', additionalProperties: false, properties: { event_id: { type: 'string' }, range: { type: 'object', additionalProperties: false, properties: { end_event_id: { type: 'string' } }, required: ['end_event_id'] } }, required: ['event_id'] },
    output,
    execute: async (args, exec) => ({ events: await store.read(sessionIdOf(exec), String(args.event_id), args.range?.end_event_id) }),
  }), 'witches-experts: durable history_read')
  ctx.effect(() => ctx.tools.register({
    name: 'artifact_read',
    description: 'Read one artifact referenced by an authorized history event.',
    parameters: { type: 'object', additionalProperties: false, properties: { artifact_id: { type: 'string' } }, required: ['artifact_id'] },
    output,
    execute: async (args, exec) => {
      const content = await store.readArtifact(sessionIdOf(exec), String(args.artifact_id))
      return content === null ? { found: false } : { found: true, artifact_id: String(args.artifact_id), content }
    },
  }), 'witches-experts: artifact_read')
  return store
}
