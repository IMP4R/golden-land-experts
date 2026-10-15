import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { AGENT_ROLE, stampAgentRole } from './agent-role.js'
import { createRlmCodeBindings } from './rlm-code.js'

const SEARCH_DEFAULT = 10
const SEARCH_MAX = 50
const READ_MAX = 200

function dshHome() {
  return process.env.DSH_HOME || join(process.cwd(), 'runtime', 'dsh-home-witches')
}

function clip(text, max = 280) {
  const normalized = String(text || '').replace(/\s+/g, ' ').trim()
  return normalized.length <= max ? normalized : `${normalized.slice(0, max - 1)}…`
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 20)
}

function parseJsonl(text) {
  return text.split('\n').filter(Boolean).flatMap(line => {
    try { return [JSON.parse(line)] } catch { return [] }
  })
}

/** Persist bounded RLM lookup and spawn records beneath clone DSH_HOME. */
export class RlmJournal {
  constructor(root = join(dshHome(), 'memory', 'rlm')) {
    this.root = root
    this.path = join(root, 'runs.jsonl')
    this.records = []
    this.writeChain = Promise.resolve()
    this.ready = this.load()
  }

  async load() {
    await mkdir(this.root, { recursive: true })
    let text = ''
    try { text = await readFile(this.path, 'utf8') } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    this.records = parseJsonl(text)
  }

  async append(record) {
    await this.ready
    const stored = { record_id: `rlm-${randomUUID()}`, timestamp: new Date().toISOString(), ...record }
    this.writeChain = this.writeChain.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      await writeFile(this.path, `${JSON.stringify(stored)}\n`, { flag: 'a' })
      this.records.push(stored)
    })
    await this.writeChain
    return stored
  }

  async list(sessionId, limit = 100) {
    await this.ready
    await this.writeChain
    return this.records.filter(record => record.session_id === sessionId).slice(-Math.max(1, Math.min(500, Number(limit) || 100)))
  }

  async listAll() {
    await this.ready
    await this.writeChain
    return this.records.slice()
  }
}

function authorized(sessionId, event) {
  return event.privacy_scope === 'shared' || event.privacy_scope === `witch:${sessionId}`
}

function boundedEvents(events, maxChars) {
  const retained = []
  let used = 2
  for (const event of events) {
    const next = JSON.stringify(event)
    if (used + next.length + 1 > maxChars) break
    retained.push(event)
    used += next.length + 1
  }
  return { events: retained, truncated: retained.length !== events.length, source_event_ids: retained.map(event => event.event_id) }
}

/** Create a bounded, source-cited reader over durable history. */
export function createRlmReader(history, sessionId, journal, limits = {}) {
  const maxLookups = Math.max(1, Math.min(100, Number(limits.maxLookups) || 20))
  const maxChars = Math.max(200, Math.min(8000, Number(limits.maxChars) || 2000))
  let lookupCount = 0
  const lookup = async (kind, input, operation) => {
    if (lookupCount >= maxLookups) throw new Error(`RLM lookup limit reached (${maxLookups})`)
    lookupCount += 1
    const result = await operation()
    const bounded = Array.isArray(result)
      ? boundedEvents(result, maxChars)
      : result && Array.isArray(result.events)
        ? { ...result, ...boundedEvents(result.events, maxChars) }
        : result
    const returnedChars = JSON.stringify(bounded).length
    await journal.append({ session_id: sessionId, kind, query_hash: digest(JSON.stringify(input)), lookup_number: lookupCount, returned_chars: returnedChars, source_event_ids: bounded?.source_event_ids || [] })
    return bounded
  }
  return {
    search: (query, scope, limit) => lookup('history.search', { query, scope, limit }, async () => {
      const hits = await history.search(sessionId, query, scope, Math.min(SEARCH_MAX, Number(limit) || SEARCH_DEFAULT))
      return hits.filter(hit => authorized(sessionId, { privacy_scope: hit.privacy_scope }))
    }),
    read: (eventId, endEventId) => lookup('history.read', { eventId, endEventId }, async () => history.read(sessionId, eventId, endEventId)),
    get lookupCount() { return lookupCount },
    maxChars,
    maxLookups,
  }
}

function outputSpec() {
  return { schema: { type: 'object', additionalProperties: true }, render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }] }
}

/** Register bounded RLM history tools and programmatic shared-expert spawn. */
export function registerRlm(ctx, { history, journal = new RlmJournal(), limits = {}, experts = history.experts || [], spawnExpert, nativeTools = true }) {
  if (!nativeTools && !ctx.tools?.extendCodeMode) throw new Error('RLM Code Mode requires tools.extendCodeMode')
  const bindingState = createRlmCodeBindings({ history, journal, experts, spawnExpert, limits })
  const removeCodeMode = nativeTools ? undefined : ctx.tools.extendCodeMode({
    extraBindings: () => [bindingState.namespace],
    extraSdk: () => [bindingState.sdk],
  })
  if (removeCodeMode && ctx.effect) ctx.effect(() => removeCodeMode, 'witches-rlm: Code Mode namespace')
  if (!nativeTools) return { tools: [], dispose: () => removeCodeMode?.() }
  const maxLookups = Math.max(1, Math.min(100, Number(limits.maxLookups) || 20))
  const maxChars = Math.max(200, Math.min(8000, Number(limits.maxChars) || 2000))
  const sessionIdOf = exec => String(exec?.agent?.session?.id || '')
  const output = outputSpec()
  const tools = []
  const register = spec => tools.push(ctx.effect(() => ctx.tools.register(spec), `witches-rli: ${spec.name}`))

  register({
    name: 'rlm_search',
    description: 'Search durable session history through bounded RLM lookup; returns concise fragments with source event ids.',
    parameters: { type: 'object', additionalProperties: false, properties: { query: { type: 'string' }, scope: { type: 'string' }, limit: { type: 'number' } }, required: ['query'] },
    output,
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec)
      const reader = createRlmReader(history, sessionId, journal, { maxLookups, maxChars })
      const result = await reader.search(args.query, args.scope, args.limit)
      const eventIds = result.events.map(event => event.event_id)
      return { ...result, lookup_count: reader.lookupCount, source_event_ids: eventIds }
    },
  })
  register({
    name: 'rlm_read',
    description: 'Read one source-cited event or inclusive range from durable history under strict RLM lookup and size limits.',
    parameters: { type: 'object', additionalProperties: false, properties: { event_id: { type: 'string' }, end_event_id: { type: 'string' } }, required: ['event_id'] },
    output,
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec)
      const reader = createRlmReader(history, sessionId, journal, { maxLookups, maxChars })
      const events = await reader.read(args.event_id, args.end_event_id)
      return { ...events, lookup_count: reader.lookupCount }
    },
  })
  register({
    name: 'rlm_spawn',
    description: 'Programmatically start one shared expert from a compact RLM context variable and explicit source event ids.',
    parameters: {
      type: 'object', additionalProperties: false,
      properties: {
        expert_id: { type: 'string' }, goal: { type: 'string' }, scope: { type: 'string' }, acceptance: { type: 'string' },
        context_query: { type: 'string' }, source_event_ids: { type: 'array', items: { type: 'string' } },
      },
      required: ['expert_id', 'goal', 'scope', 'acceptance'],
    },
    output,
    execute: async (args, exec) => {
      const sessionId = sessionIdOf(exec)
      const agent = exec?.agent
      if (!agent || !sessionId) return { ok: false, error: 'missing witch session context' }
      const expert = (history.experts || []).find(item => item.id === args.expert_id)
      if (!expert) return { ok: false, error: `unknown expert: ${args.expert_id}` }
      const service = ctx.subagents || ctx.get?.('subagents')
      if (!service?.start) return { ok: false, error: 'subagents service unavailable' }
      const reader = createRlmReader(history, sessionId, journal, { maxLookups, maxChars })
      let evidence = []
      if (Array.isArray(args.source_event_ids)) {
        for (const sourceId of args.source_event_ids.slice(0, 20)) evidence.push(...await history.read(sessionId, sourceId))
      }
      if (args.context_query && !evidence.length) {
        const hits = await reader.search(args.context_query, undefined, 10)
        evidence = hits.events || []
      }
      if (!evidence.length) throw new Error('RLM spawn requires at least one authorized source event')
      const serializedEvidence = JSON.stringify(evidence.map(event => ({ event_id: event.event_id, type: event.type, summary: event.summary, artifacts: event.artifact_contents })))
      if (serializedEvidence.length > maxChars) throw new Error(`RLM context exceeds configured ${maxChars} character limit`)
      const variable = serializedEvidence
      const sourceIds = evidence.map(row => row.event_id)
      const contract = [
        `goal: ${clip(args.goal, 800)}`, `scope: ${clip(args.scope, 500)}`,
        `acceptance: ${clip(args.acceptance, 800)}`, `inputs: source event ids ${sourceIds.join(',') || evidence.map(row => row.event_id).join(',') || 'none'}`,
      ].join('\n')
      const prompt = [
        `You are the shared expert ${expert.id}. Work only within the stated scope and acceptance checks.`,
        'RLM context is supplied as a bounded variable below; treat cited event ids as provenance.',
        'Do not assume or request the witch conversation. Return compact evidence, checks, and unknowns.',
        `Contract:\n${contract}`,
        `Context variable (serialized JSON, bounded to ${maxChars} characters):\n${variable}`,
      ].join('\n\n')
      const route = await history.expertRoute?.(sessionId)
      const modelSelection = agent.options || {}
      const spawn = await service.start('spawn', {
        label: `rlm:${expert.id}`,
        prompt: [{ type: 'text', text: prompt }],
        parent: agent,
        signal: exec.signal || new AbortController().signal,
        agentOptions: stampAgentRole({ provider: route?.resolvedProvider || modelSelection.provider, model: route?.resolvedModel || modelSelection.model }, AGENT_ROLE.EXPERT),
        persona: `Shared ${expert.title} expert. No inherited witch conversation. No recursive rlm_spawn.`,
        toolFilter: { deny: ['rlm_spawn', 'expert_ask', 'expert_pause', 'expert_resume', 'expert_cancel'] },
        maxDepth: 1,
      })
      const record = await journal.append({ session_id: sessionId, kind: 'rlm.spawn', expert_id: expert.id, contract_hash: digest(contract), source_event_ids: evidence.map(event => event.event_id), run_id: spawn.id, context_chars: variable.length })
      return { ok: true, run_id: spawn.id, record_id: record.record_id, source_event_ids: evidence.map(event => event.event_id), context_chars: variable.length, result_pending: true }
    },
  })
  return { journal, dispose: () => { removeCodeMode?.(); for (const dispose of tools.splice(0).reverse()) dispose?.() } }
}
