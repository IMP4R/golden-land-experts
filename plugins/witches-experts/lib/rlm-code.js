import { createHash, randomUUID } from 'node:crypto'

function hash(value) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}

/** Create Code Mode bindings over durable history and programmatic expert spawn. */
export function createRlmCodeBindings({ history, journal, experts, spawnExpert, limits = {} }) {
  const maxLookups = Math.max(1, Math.min(100, Number(limits.maxLookups) || 20))
  const maxChars = Math.max(200, Math.min(8000, Number(limits.maxChars) || 2000))
  const lookups = new Map()
  const ready = journal.ready || Promise.resolve()
  const sessionOf = exec => String(exec?.session?.id || exec?.agent?.session?.id || '')
  const rowsFor = async (exec, kind, query, rows) => {
    await ready
    const sessionId = sessionOf(exec)
    if (!sessionId) throw new Error('RLM lookup requires a session')
    if (!lookups.has(sessionId)) {
      const prior = typeof journal.listAll === 'function'
        ? (await journal.listAll()).filter(row => row.session_id === sessionId)
        : await journal.list(sessionId, 500)
      lookups.set(sessionId, prior.filter(row => row.kind === 'rlm.code.search' || row.kind === 'rlm.code.read').length)
    }
    const count = (lookups.get(sessionId) || 0) + 1
    if (count > maxLookups) throw new Error(`RLM lookup budget exceeded (${maxLookups})`)
    const items = []
    let used = 2
    for (const row of rows) {
      const encoded = JSON.stringify(row)
      if (used + encoded.length + 1 > maxChars) break
      items.push(row)
      used += encoded.length + 1
    }
    const sourceEventIds = items.map(row => row.event_id).filter(Boolean)
    const result = { items, truncated: items.length < rows.length, source_event_ids: sourceEventIds, lookup_count: count }
    while (JSON.stringify(result).length > maxChars && items.length > 0) {
      items.pop()
      result.source_event_ids = items.map(row => row.event_id).filter(Boolean)
      result.truncated = true
    }
    if (JSON.stringify(result).length > maxChars) throw new Error(`RLM result envelope exceeds ${maxChars} characters`)
    await journal.append({ session_id: sessionId, kind, query_hash: hash(JSON.stringify(query)), lookup_number: count, returned_chars: JSON.stringify(result).length, source_event_ids: result.source_event_ids })
    lookups.set(sessionId, count)
    return result
  }
  const search = async (args, exec) => {
    const sessionId = sessionOf(exec)
    const rows = await history.search(sessionId, String(args.query || ''), args.scope, Math.min(50, Math.max(1, Number(args.limit) || 10)))
    const visible = rows.map(row => ({ event_id: row.event_id, timestamp: row.timestamp, type: row.type, summary: row.summary, privacy_scope: row.privacy_scope, active: row.active, cancelled: row.cancelled }))
    return rowsFor(exec, 'rlm.code.search', { query: args.query, scope: args.scope }, visible)
  }
  const read = async (args, exec) => {
    const sessionId = sessionOf(exec)
    const rows = await history.read(sessionId, String(args.event_id || ''), args.end_event_id ? String(args.end_event_id) : undefined)
    const visible = rows.map(row => ({ event_id: row.event_id, timestamp: row.timestamp, actor: row.actor, type: row.type, summary: row.summary, privacy_scope: row.privacy_scope, cancelled: row.cancelled, active: row.active, raw: row.raw, artifact_contents: row.artifact_contents }))
    return rowsFor(exec, 'rlm.code.read', { event_id: args.event_id, end_event_id: args.end_event_id }, visible)
  }
  const spawn = async (args, exec) => {
    const sessionId = sessionOf(exec)
    if (!sessionId) throw new Error('RLM spawn requires a calling witch session')
    const expert = experts.find(item => item.id === String(args.expert_id || ''))
    if (!expert) throw new Error(`unknown shared expert: ${String(args.expert_id)}`)
    const ids = Array.isArray(args.source_event_ids) ? args.source_event_ids.slice(0, 20).map(String) : []
    const events = []
    for (const id of ids) events.push(...await history.read(sessionId, id))
    if (!events.length) throw new Error('RLM spawn requires at least one authorized source event')
    const context = JSON.stringify(events.map(event => ({ event_id: event.event_id, summary: event.summary, type: event.type, artifacts: event.artifact_contents })))
    if (context.length > maxChars) throw new Error(`RLM context exceeds configured ${maxChars} character limit`)
    const contract = { goal: String(args.goal || ''), scope: String(args.scope || ''), acceptance: String(args.acceptance || ''), source_event_ids: events.map(event => event.event_id) }
    const run = await spawnExpert(exec, expert, contract, context)
    const spawnId = `rlm-spawn-${randomUUID()}`
    await journal.append({ session_id: sessionId, kind: 'rlm.code.spawn', spawn_id: spawnId, expert_id: expert.id, goal_hash: hash(contract.goal), source_event_ids: contract.source_event_ids, run_id: run.id, context_chars: context.length })
    return { spawn_id: spawnId, run_id: run.id, expert_id: expert.id, source_event_ids: contract.source_event_ids, context_chars: context.length, result_pending: true }
  }
  return {
    namespace: { global: 'rlm', functions: { search, read, spawn } },
    sdk: [
      'RLM bindings are available through the `rlm` namespace in the program.',
      '`await rlm.search({query, scope?, limit?})` returns bounded `{items, truncated, source_event_ids, lookup_count}`.',
      '`await rlm.read({event_id, end_event_id?})` reads one event or inclusive range; cite its event ids.',
      '`await rlm.spawn({expert_id, goal, scope, acceptance, source_event_ids})` starts one shared expert programmatically and returns its run id.',
      `Maximum ${maxLookups} lookups per session and ${maxChars} characters per returned history value.`,
    ].join('\n'),
  }
}
