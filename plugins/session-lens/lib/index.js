/**
 * session-lens: read another session from its end, cheaply.
 *
 * A session is a long append-only log, and the useful part of it is almost
 * always the end. Replaying one into a prompt from the beginning is what makes
 * cross-session work expensive, and on a long session impossible. This plugin
 * exposes four tools that make the cost proportional to what the caller asks
 * for rather than to how much the other session contains:
 *
 *  - `session_map` — what sessions exist, and which match a query. Free: it
 *    reads headers, never logs.
 *  - `session_tail` — the last N characters of one session's dialogue. A
 *    backward walk, so a budget spent on a huge session buys its present.
 *  - `session_find` — where a term occurs, as seq numbers, without returning
 *    the surrounding text.
 *  - `session_digest` — a map of a session too large to read, built by
 *    recursively compressing it with the CHEAP model and returning only the
 *    result. The intermediate chunks never enter the caller's context.
 *
 * The last one is the point of the package: the expensive session pays a cheap
 * model to read itself, and the caller receives a bounded summary instead of a
 * transcript. Compaction is recursive in the sense that matters — chunks are
 * compressed independently, then their summaries are assembled under their own
 * budget, so a session of any length produces a map of a fixed size.
 *
 * @module session-lens
 */

import {
  DEFAULT_READ_BUDGET,
  assembleMap,
  chunkLines,
  cleanLine,
  compactPrompt,
  linesOfEvents,
  rankSessions,
  tailOf,
} from './extract.js'

export const name = 'session-lens'

/**
 * `tools` is the only hard dependency: without the registry there is nothing to
 * register.
 *
 * `sessionPersistence` and `llm` are read through `ctx.get` instead, because
 * this plugin mounts in the PROFILE plane (the client-module scanner only sees
 * Loader rows declared there) while the session services are assembled around
 * the agent. A hard `inject` would refuse the mount in a deployment that
 * composes them differently, and each tool already reports its own missing
 * dependency more usefully than a boot failure would.
 */
export const inject = ['tools']

/** Characters one cheap-model compaction request may carry. */
const COMPACT_CHUNK_CHARS = 24_000

/** Characters the assembled digest may occupy. */
const DIGEST_BUDGET_CHARS = 16_000

/** Generous cap on a digest's cheap-model calls, so a huge session cannot run away. */
const MAX_COMPACT_CHUNKS = 24

/** The route a digest uses when the caller names none. */
const DEFAULT_CHEAP_ROUTE = { provider: 'cheapvibecode', model: 'deepseek-v4.1-flash' }

/**
 * The output declaration every tool here shares.
 *
 * `render` is required by the registry rather than optional: it is what turns
 * the tool's value into the blocks a caller reads. Returning the JSON as text
 * keeps the result legible to the model, and the client half renders the same
 * value as session links — the two faces read one value, not two.
 * @returns the tool's output declaration.
 */
function jsonOutput() {
  return {
    schema: { type: 'object', additionalProperties: true },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
  }
}

/**
 * Read one session's rendered dialogue lines.
 * @param ctx - the plugin context, for the persistence service.
 * @param sessionId - the session to read.
 * @returns the rendered lines in seq order.
 */
async function linesOfSession(ctx, sessionId) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) {
    throw new Error('session-lens: no sessionPersistence service is configured, so no session can be read')
  }
  const inspected = await persistence.inspect(sessionId)
  return linesOfEvents(inspected.events)
}

/**
 * Summarize one header for a listing.
 *
 * The artifact path is included because a session's id is not a location: a
 * reader who wants to open the log, copy it, or diff it needs the file, and
 * only the persistence backend knows where that file is.
 * @param header - a session header.
 * @param persistence - the backend, for its artifact location.
 * @returns the listing row.
 */
function summaryOf(header, persistence) {
  const row = {
    id: String(header.id),
    createdAt: header.createdAt,
    cwd: header.cwd,
  }
  const location = persistence.locate(header)
  if (location !== undefined) row.path = location.path
  if (header.parentSession !== undefined) row.parentSession = String(header.parentSession)
  if (header.origin !== undefined) row.origin = String(header.origin)
  if (header.delegationDepth !== undefined) row.delegationDepth = header.delegationDepth
  if (header.agentPreset !== undefined) row.agentPreset = String(header.agentPreset)
  if (header.title !== undefined) row.title = String(header.title)
  return row
}

export function apply(ctx) {
  /**
   * Map the sessions this deployment can see.
   *
   * Headers only, so it costs nothing on a store with hundreds of sessions and
   * is safe to call before deciding what to read. `withSizes` additionally
   * loads each log to count its dialogue lines, which is the only way to know
   * how large a session is before paying to read it — so it is opt-in rather
   * than the default.
   */
  ctx.effect(() => ctx.tools.register({
    name: 'session_map',
    description: 'List the sessions this deployment can read, with their ids, parent links, preset, and title. Costs nothing: reads headers, not logs. Pass `withSizes` to also count each session\'s dialogue lines, or `query` to rank sessions against free text. Use the returned ids with session_tail, session_find, and session_digest.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        query: { type: 'string', description: 'Free text matched against title, id, and cwd. Omit to list every session.' },
        withSizes: { type: 'boolean', description: 'Also load each log to count dialogue lines. Costs one log read per session.' },
        limit: { type: 'number', description: 'Maximum rows returned. Defaults to 40.' },
      },
    },
    output: jsonOutput(),
    execute: async (args) => {
      const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(500, Number(args.limit))) : 40
      const persistence = ctx.get('sessionPersistence')
      if (persistence === undefined) {
        return { total: 0, returned: 0, sessions: [], error: 'no sessionPersistence service is configured' }
      }
      const headers = await persistence.list()
      const rows = headers.map(header => summaryOf(header, persistence))

      if (args.withSizes === true) {
        for (const row of rows) {
          const lines = await linesOfSession(ctx, row.id)
          row.events = lines.length
          const last = lines[lines.length - 1]
          if (last !== undefined) row.lastSeq = last.seq
        }
      }

      const query = typeof args.query === 'string' ? args.query : ''
      if (query.trim().length === 0) {
        const sorted = rows
          .sort((a, b) => String(b.createdAt ?? '').localeCompare(String(a.createdAt ?? '')))
          .slice(0, limit)
        return { total: rows.length, returned: sorted.length, sessions: sorted }
      }

      // A query searches bodies, which means reading logs. That is the one case
      // where a map is not free, and the result says so rather than pretending.
      const bodies = new Map()
      for (const row of rows) {
        const lines = await linesOfSession(ctx, row.id)
        bodies.set(row.id, lines.map(line => line.text).join('\n'))
      }
      const ranked = rankSessions(rows, query, bodies).slice(0, limit)
      return {
        total: rows.length,
        returned: ranked.length,
        searchedBodies: true,
        sessions: ranked.map(entry => ({ ...entry.session, score: entry.score, why: entry.why })),
      }
    },
  }), 'session-lens: session_map')

  /**
   * Read the END of another session.
   *
   * The budget is spent walking backward, so the newest dialogue always
   * survives and a session too large to read loses its distant past instead of
   * its present. `nextBeforeSeq` pages further back without re-reading what was
   * already returned.
   */
  ctx.effect(() => ctx.tools.register({
    name: 'session_tail',
    description: 'Read the END of another session\'s dialogue — user, assistant, and tool text, newest kept first when the budget runs out. Returns lines in ascending seq order plus `nextBeforeSeq` for paging further back. This is the cheap way to catch up on a session you did not participate in.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'The session to read, from session_map.' },
        maxChars: { type: 'number', description: 'Character budget for this read. Defaults to 24000.' },
        maxLines: { type: 'number', description: 'Line cap for this read. Defaults to 400.' },
        beforeSeq: { type: 'number', description: 'Read only lines strictly before this seq. Pass a previous read\'s nextBeforeSeq to page back.' },
        roles: {
          type: 'array',
          items: { type: 'string' },
          description: 'Keep only these roles, e.g. ["user","assistant"] to skip tool output.',
        },
      },
      required: ['sessionId'],
    },
    output: jsonOutput(),
    execute: async (args) => {
      const sessionId = String(args.sessionId)
      const budget = {
        maxChars: Number.isFinite(Number(args.maxChars)) ? Math.max(200, Number(args.maxChars)) : DEFAULT_READ_BUDGET.maxChars,
        maxLines: Number.isFinite(Number(args.maxLines)) ? Math.max(1, Number(args.maxLines)) : DEFAULT_READ_BUDGET.maxLines,
      }
      let lines = await linesOfSession(ctx, sessionId)
      if (Array.isArray(args.roles) && args.roles.length > 0) {
        const keep = new Set(args.roles.map(String))
        lines = lines.filter(line => keep.has(line.role))
      }
      const beforeSeq = Number.isFinite(Number(args.beforeSeq)) ? Number(args.beforeSeq) : undefined
      const tail = tailOf(lines, budget, beforeSeq)
      return {
        sessionId,
        fromSeq: tail.fromSeq,
        toSeq: tail.toSeq,
        hasMore: tail.hasMore,
        nextBeforeSeq: tail.nextBeforeSeq,
        chars: tail.chars,
        returnedLines: tail.lines.length,
        totalLines: tail.totalLines,
        lines: tail.lines,
      }
    },
  }), 'session-lens: session_tail')

  /**
   * Locate a term in another session without returning the session.
   *
   * This is the cheapest useful read: a caller usually knows WHAT it is looking
   * for and only needs to know WHERE, then reads that range with session_tail's
   * `beforeSeq`/`roles` or a bounded `maxChars`.
   */
  ctx.effect(() => ctx.tools.register({
    name: 'session_find',
    description: 'Find where a term occurs in another session and return the seq numbers with a short context window around each hit — never the whole session. Use it to decide which range is worth reading, then read it with session_tail.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'The session to search, from session_map.' },
        query: { type: 'string', description: 'Text to find, matched case-insensitively.' },
        contextChars: { type: 'number', description: 'Characters of surrounding text per hit. Defaults to 160.' },
        limit: { type: 'number', description: 'Maximum hits. Defaults to 20.' },
      },
      required: ['sessionId', 'query'],
    },
    output: jsonOutput(),
    execute: async (args) => {
      const sessionId = String(args.sessionId)
      const needle = String(args.query).toLowerCase()
      if (needle.length === 0) return { sessionId, hits: [], note: 'empty query' }
      const contextChars = Number.isFinite(Number(args.contextChars)) ? Math.max(0, Number(args.contextChars)) : 160
      const limit = Number.isFinite(Number(args.limit)) ? Math.max(1, Math.min(200, Number(args.limit))) : 20
      const lines = await linesOfSession(ctx, sessionId)
      const hits = []
      for (const line of lines) {
        const lower = line.text.toLowerCase()
        let from = 0
        for (;;) {
          const at = lower.indexOf(needle, from)
          if (at < 0) break
          const start = Math.max(0, at - contextChars)
          const end = Math.min(line.text.length, at + needle.length + contextChars)
          hits.push({
            seq: line.seq,
            role: line.role,
            at,
            excerpt: cleanLine(line.text.slice(start, end)),
          })
          from = at + needle.length
          if (hits.length >= limit) break
        }
        if (hits.length >= limit) break
      }
      return { sessionId, hits, truncated: hits.length >= limit }
    },
  }), 'session-lens: session_find')

  /**
   * Build a bounded map of a session too large to read.
   *
   * The session is chunked, each chunk is compressed by the CHEAP model, and
   * only the assembled summaries reach the caller. This is the recursive part:
   * the map's own budget is applied to the summaries, so a session of any
   * length yields a map of a fixed size, and the newest material is what
   * survives when even the map does not fit.
   *
   * The model calls are recorded with their provider usage, because a caller
   * deciding whether to digest a session needs to know what it cost.
   */
  ctx.effect(() => ctx.tools.register({
    name: 'session_digest',
    description: 'Build a bounded map of a session that is too large to read directly. The session is compressed chunk by chunk with the CHEAP model and only the resulting map is returned — the transcript never enters your context. Use it before session_tail when session_map reports a session with many lines.',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        sessionId: { type: 'string', description: 'The session to digest, from session_map.' },
        provider: { type: 'string', description: 'Provider for the cheap compaction calls. Defaults to the deployment cheap route.' },
        model: { type: 'string', description: 'Model for the cheap compaction calls. Defaults to the deployment cheap route.' },
        focus: { type: 'string', description: 'What the map should emphasize, e.g. "decisions about the broker budget".' },
        maxChars: { type: 'number', description: 'Character budget for the returned map. Defaults to 16000.' },
      },
      required: ['sessionId'],
    },
    output: jsonOutput(),
    execute: async (args, exec) => {
      const sessionId = String(args.sessionId)
      const llm = ctx.get('llm')
      if (llm === undefined || typeof llm.stream !== 'function') {
        return { sessionId, error: 'no llm service is configured; digest needs a cheap route' }
      }
      const route = {
        provider: typeof args.provider === 'string' && args.provider.length > 0 ? args.provider : DEFAULT_CHEAP_ROUTE.provider,
        model: typeof args.model === 'string' && args.model.length > 0 ? args.model : DEFAULT_CHEAP_ROUTE.model,
      }
      const budgetChars = Number.isFinite(Number(args.maxChars)) ? Math.max(500, Number(args.maxChars)) : DIGEST_BUDGET_CHARS
      const focus = typeof args.focus === 'string' ? args.focus.trim() : ''

      const lines = await linesOfSession(ctx, sessionId)
      if (lines.length === 0) return { sessionId, map: '', chunks: 0, note: 'this session has no dialogue' }

      const chunks = chunkLines(lines, COMPACT_CHUNK_CHARS)
      const selected = chunks.length > MAX_COMPACT_CHUNKS
        // Over the cap the NEWEST chunks are digested: a map of a huge session
        // is worth having only if it describes where the session got to.
        ? chunks.slice(chunks.length - MAX_COMPACT_CHUNKS)
        : chunks

      const summaries = []
      const usage = []
      for (const chunk of selected) {
        const packed = compactPrompt(chunk, sessionId)
        const instruction = focus.length > 0
          ? `${packed.instruction} Emphasize: ${focus}.`
          : packed.instruction
        // Text arrives as DELTAS keyed by block index, not as finished blocks:
        // a chunk carries a fragment and the fragments join by index. Reading
        // `chunk.text` finds nothing and silently produces an empty summary —
        // which is exactly what a map must not do.
        const fragments = new Map()
        let tokens
        const message = {
          role: 'user',
          id: `session-lens-${chunk[0]?.seq ?? 0}`,
          content: [{ type: 'text', text: packed.user }],
          source: { kind: 'plugin', plugin: name, form: 'session-digest' },
        }
        for await (const piece of llm.stream({
          provider: route.provider,
          model: route.model,
          system: instruction,
          messages: [message],
          maxTokens: 2048,
          signal: exec?.signal,
        })) {
          if (piece?.type === 'usage' && piece.usage) tokens = piece.usage
          if (piece?.type === 'text-delta' && typeof piece.text === 'string') {
            const index = Number.isFinite(piece.index) ? piece.index : 0
            fragments.set(index, (fragments.get(index) ?? '') + piece.text)
          }
        }
        const visible = [...fragments.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(entry => entry[1])
          .join('\n')
        summaries.push(cleanLine(visible) || '(the cheap model returned no summary for this slice)')
        const row = {
          seqFrom: chunk[0]?.seq ?? -1,
          seqTo: chunk[chunk.length - 1]?.seq ?? -1,
        }
        // Omitted rather than set to `undefined`: a property holding `undefined`
        // is not lossless JSON, and the registry rejects the whole result for it.
        if (Number.isFinite(tokens?.inputTokens)) row.inputTokens = tokens.inputTokens
        if (Number.isFinite(tokens?.outputTokens)) row.outputTokens = tokens.outputTokens
        usage.push(row)
      }

      const assembled = assembleMap(summaries, budgetChars)
      return {
        sessionId,
        route: `${route.provider}/${route.model}`,
        totalLines: lines.length,
        totalChunks: chunks.length,
        digestedChunks: selected.length,
        firstDigestedSeq: selected[0]?.[0]?.seq ?? -1,
        mapBudgetChars: budgetChars,
        mapChars: assembled.text.length,
        summariesIncluded: assembled.included,
        summariesDropped: assembled.dropped,
        usage,
        map: assembled.text,
      }
    },
  }), 'session-lens: session_digest')
}
