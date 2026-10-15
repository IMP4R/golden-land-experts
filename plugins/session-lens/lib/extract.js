/**
 * Reading another session without paying for it.
 *
 * A session's log is an append-only event stream, and the part a reader almost
 * always wants is the END of it: what was decided, what is still open, what was
 * tried last. Reading forward from the beginning spends tokens on history that
 * has already been superseded, and on a long session it does not fit at all.
 *
 * This module is the pure half of that: turning raw session events into
 * budgeted text, reading them from the end, and deciding what a cheap model
 * must be asked to compress. It touches no Cordis service, no filesystem, and
 * no network, so every rule here is testable on its own.
 *
 * Two budgets are deliberately separate, because they answer different
 * questions. `read` bounds how much text one call returns to the caller;
 * `compact` bounds how much text one cheap-model request may carry. Conflating
 * them would let a large read silently become a large bill.
 *
 * @module session-lens/extract
 */

/**
 * The default read budget: one screen of context, not one session.
 * @type {{ maxChars: number, maxLines: number }}
 */
export const DEFAULT_READ_BUDGET = { maxChars: 24_000, maxLines: 400 }

/**
 * Characters that can corrupt a rendered line or deceive a reader.
 *
 * The same classes the title normalizer removes, for the same reason: session
 * text is untrusted input that reaches a model.
 */
const OSC_SEQUENCE = /(?:\u001B\]|\u009D)(?:(?!\u0007|\u001B\\)[\s\S])*(?:\u0007|\u001B\\|$)/gu
const CSI_SEQUENCE = /(?:\u001B\[|\u009B)[0-?]*[ -/]*[@-~]/gu
const ESC_SEQUENCE = /\u001B[@-_]/gu
const CONTROL_CHARACTER = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/gu
const DIRECTIONAL_CONTROL = /[\u200B\u200E\u200F\u202A-\u202E\u2060-\u2064\u2066-\u206F\uFEFF]/gu

/**
 * Render untrusted session text as one safe line.
 * @param {string} input - raw text from a session event.
 * @returns {string} the text with control sequences removed and whitespace collapsed.
 */
export function cleanLine(input) {
  return input
    .replace(OSC_SEQUENCE, '')
    .replace(CSI_SEQUENCE, '')
    .replace(ESC_SEQUENCE, '')
    .replace(CONTROL_CHARACTER, '')
    .replace(DIRECTIONAL_CONTROL, '')
    .replace(/\s+/gu, ' ')
    .trim()
}

/**
 * Read the text out of one message's content blocks.
 *
 * Only `text` blocks contribute. Reasoning blocks are excluded on purpose: they
 * are the model's private working, they are the bulk of a session's bytes, and
 * a reader asking what a session concluded does not want to pay for how it got
 * there. A tool result contributes its text, which is where a command's output
 * actually lives.
 * @param {unknown} content - the message's content array.
 * @returns {string} the joined visible text.
 */
export function textOfContent(content) {
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    if (block.type !== 'text') continue
    if (typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n')
}

/**
 * Render one session event as a line, or reject it as unrenderable.
 *
 * The event vocabulary is the harness's, and most of it is bookkeeping: turn
 * boundaries, chunk streams, request headers, usage accounting. A reader wants
 * the conversation, so everything else is dropped rather than rendered as
 * noise the caller pays for.
 * @param {unknown} event - one event from a session log.
 * @returns {{ seq: number, role: string, type: string, text: string } | undefined} the rendered line, or undefined when the event carries no dialogue.
 */
export function lineOfEvent(event) {
  if (typeof event !== 'object' || event === null) return undefined
  const type = typeof event.type === 'string' ? event.type : ''
  const seq = typeof event.seq === 'number' ? event.seq : -1
  const data = typeof event.data === 'object' && event.data !== null ? event.data : undefined
  if (data === undefined) return undefined

  if (type === 'user/message') {
    // A user event carries its message fields flat; only the assistant and tool
    // events wrap theirs under `message`. Reading both the same way is how a
    // reader silently loses every human turn in the session.
    const text = cleanLine(textOfContent(data.content))
    if (text.length === 0) return undefined
    const sourceKind = typeof data.source === 'object' && data.source !== null
      ? data.source.kind
      : undefined
    // A user/message the harness injected is not something a human said. The
    // distinction matters to a reader reconstructing a conversation, and it is
    // the same rule the Memory Broker uses to decide what is authentic.
    const role = sourceKind === 'user' ? 'user' : `user:${String(sourceKind ?? 'unknown')}`
    return { seq, role, type, text }
  }

  if (type === 'assistant/message') {
    const message = data.message
    if (typeof message !== 'object' || message === null) return undefined
    const text = cleanLine(textOfContent(message.content))
    if (text.length === 0) return undefined
    return { seq, role: 'assistant', type, text }
  }

  if (type === 'tool/result') {
    const message = data.message
    if (typeof message !== 'object' || message === null) return undefined
    const text = cleanLine(textOfContent(message.content))
    if (text.length === 0) return undefined
    return { seq, role: 'tool', type, text }
  }

  return undefined
}

/**
 * Render a whole event list, dropping everything that is not dialogue.
 * @param {readonly unknown[]} events - events in seq order.
 * @returns {Array<{ seq: number, role: string, type: string, text: string }>} the rendered lines in seq order.
 */
export function linesOfEvents(events) {
  const lines = []
  for (const event of events) {
    const line = lineOfEvent(event)
    if (line !== undefined) lines.push(line)
  }
  return lines
}

/**
 * Take the last lines of a session within a budget.
 *
 * The read walks BACKWARD from the end, so the budget is spent on the most
 * recent dialogue and a long session degrades by losing its distant past rather
 * than its present. The returned lines are re-sorted ascending, because a reader
 * reconstructing what happened needs causal order even though the budget was
 * spent in reverse.
 * @param lines - rendered lines in seq order.
 * @param budget - the character and line caps for this read.
 * @param beforeSeq - read only lines strictly before this seq, for paging back.
 * @returns the budgeted tail and how to continue.
 */
export function tailOf(lines, budget = DEFAULT_READ_BUDGET, beforeSeq) {
  const eligible = beforeSeq === undefined
    ? lines
    : lines.filter(line => line.seq < beforeSeq)

  const chosen = []
  let chars = 0
  let index = eligible.length - 1
  let consumedAll = true

  for (; index >= 0; index -= 1) {
    const line = eligible[index]
    if (line === undefined) break
    if (chosen.length >= budget.maxLines) { consumedAll = false; break }
    const remaining = budget.maxChars - chars
    if (remaining <= 0) { consumedAll = false; break }
    if (line.text.length <= remaining) {
      chosen.push({ seq: line.seq, role: line.role, text: line.text })
      chars += line.text.length
      continue
    }
    // A line larger than what is left is cut, not dropped: the newest content
    // is the most valuable, and a tool result can easily be longer than the
    // whole budget. The head is kept because that is where a result states
    // what it did.
    chosen.push({
      seq: line.seq,
      role: line.role,
      text: line.text.slice(0, remaining),
      truncated: true,
    })
    chars += remaining
    consumedAll = false
    break
  }

  chosen.reverse()
  const first = chosen[0]
  const last = chosen[chosen.length - 1]
  const fromSeq = first?.seq ?? -1
  const toSeq = last?.seq ?? -1
  const hasMore = !consumedAll || index >= 0

  const result = {
    lines: chosen,
    fromSeq,
    toSeq,
    hasMore,
    chars,
    totalLines: eligible.length,
  }
  if (hasMore && chosen.length > 0) result.nextBeforeSeq = fromSeq
  return result
}

/**
 * Rank sessions against a free-text query.
 *
 * The score is deliberately explainable rather than clever: a match in a
 * session's title or id outranks a match in its body, and the number of body
 * matches breaks ties. A caller reading the score can see WHY a session ranked,
 * which a vector similarity would hide.
 * @param sessions - the sessions to rank.
 * @param query - free text; matched case-insensitively over title, id, and cwd.
 * @param bodies - optional per-session text to search, keyed by session id.
 * @returns the matching sessions, best first, each with the reason it matched.
 */
export function rankSessions(sessions, query, bodies) {
  const needle = query.trim().toLowerCase()
  const ranked = []
  for (const session of sessions) {
    let score = 0
    const why = []
    if (needle.length === 0) {
      ranked.push({ session, score: 0, why: 'no query' })
      continue
    }
    if (session.title !== undefined && session.title.toLowerCase().includes(needle)) {
      score += 100
      why.push('title')
    }
    if (session.id.toLowerCase().includes(needle)) {
      score += 50
      why.push('id')
    }
    if (session.cwd !== undefined && session.cwd.toLowerCase().includes(needle)) {
      score += 10
      why.push('cwd')
    }
    const body = bodies?.get(session.id)
    if (body !== undefined) {
      const lower = body.toLowerCase()
      let from = 0
      let hits = 0
      for (;;) {
        const at = lower.indexOf(needle, from)
        if (at < 0) break
        hits += 1
        from = at + needle.length
        if (hits >= 50) break
      }
      if (hits > 0) {
        score += Math.min(hits, 20)
        why.push(`${hits} body hit(s)`)
      }
    }
    if (score > 0) ranked.push({ session, score, why: why.join(', ') })
  }
  ranked.sort((a, b) => b.score - a.score || a.session.id.localeCompare(b.session.id))
  return ranked
}

/**
 * Split lines into the chunks a cheap model will be asked to compress.
 *
 * Chunking is by characters rather than by turn, because the budget that
 * matters is the model's context, and a single turn can exceed it. A line is
 * never split across chunks unless it alone exceeds the budget, so a chunk
 * boundary never lands mid-sentence in the common case.
 * @param lines - rendered lines in seq order.
 * @param maxChars - the character budget for one cheap-model request.
 * @returns the chunks, each a contiguous run of lines, in order.
 */
export function chunkLines(lines, maxChars) {
  if (maxChars <= 0) throw new Error('chunkLines: maxChars must be positive')
  const chunks = []
  let current = []
  let size = 0
  for (const line of lines) {
    const cost = line.text.length + 1
    if (current.length > 0 && size + cost > maxChars) {
      chunks.push(current)
      current = []
      size = 0
    }
    current.push(line)
    size += cost
  }
  if (current.length > 0) chunks.push(current)
  return chunks
}

/** The instruction one compaction request carries. */
export const COMPACT_INSTRUCTION = [
  'You compress one slice of a longer conversation for a reader who will never see the original.',
  'Preserve: decisions made, files and commands touched, errors and their causes, open questions, and anything the participants committed to.',
  'Drop: greetings, restatements, reasoning, and anything recoverable from a file the slice names.',
  'Write plain prose. Name the seq range you were given so the reader can go back to the original.',
  'Never invent a fact the slice does not contain. If the slice is empty of substance, say so in one line.',
].join(' ')

/**
 * Build the request one compaction chunk carries.
 * @param chunk - the lines to compress.
 * @param sessionId - the session being compacted, named so the summary is traceable.
 * @returns the system instruction and the user text for the cheap model.
 */
export function compactPrompt(chunk, sessionId) {
  const first = chunk[0]
  const last = chunk[chunk.length - 1]
  const range = first !== undefined && last !== undefined ? `seq ${first.seq}..${last.seq}` : 'an empty range'
  const body = chunk.map(line => `[${line.seq}] ${line.role}: ${line.text}`).join('\n')
  return {
    instruction: COMPACT_INSTRUCTION,
    user: `Session ${sessionId}, ${range}:\n\n${body}`,
  }
}

/**
 * Join chunk summaries into one map of the session.
 *
 * The head is the newest summary, because a reader of a long session needs the
 * present before the past; the tail of the list is the oldest material and is
 * the first thing dropped when the map itself must fit a budget.
 * @param summaries - one summary per chunk, in ascending seq order.
 * @param budgetChars - the character cap for the assembled map.
 * @returns the map text and how many of the newest summaries it contains.
 */
export function assembleMap(summaries, budgetChars) {
  const kept = []
  let size = 0
  for (let index = summaries.length - 1; index >= 0; index -= 1) {
    const summary = summaries[index]
    if (summary === undefined) continue
    if (size + summary.length > budgetChars && kept.length > 0) break
    kept.push(summary)
    size += summary.length
  }
  kept.reverse()
  return { text: kept.join('\n\n'), included: kept.length, dropped: summaries.length - kept.length }
}
