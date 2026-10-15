// session-lens pure rules, asserted without a runtime.
//
// The load-bearing claims are about BUDGETS: a tail read must spend its budget
// on the newest dialogue, a digest must compress rather than forward, and a
// rendering must not pay for reasoning blocks. Each test below fails if the
// corresponding rule is inverted, so the suite distinguishes the design from
// its opposite rather than confirming that functions were called.

import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_READ_BUDGET,
  assembleMap,
  chunkLines,
  cleanLine,
  compactPrompt,
  lineOfEvent,
  linesOfEvents,
  rankSessions,
  tailOf,
  textOfContent,
} from '../lib/extract.js'

/**
 * Build a user message event with the given text.
 *
 * The shape is the one the durable log actually writes: a user event carries
 * its message fields FLAT, unlike assistant and tool events which wrap theirs
 * under `message`. A fixture that guessed otherwise would test the renderer
 * against a shape no session ever produces.
 */
function userEvent(seq, text, sourceKind = 'user') {
  return {
    seq,
    type: 'user/message',
    data: {
      id: `m-${seq}`,
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: sourceKind },
    },
  }
}

/** Build an assistant message event with the given text. */
function assistantEvent(seq, text) {
  return {
    seq,
    type: 'assistant/message',
    data: {
      message: {
        id: `a-${seq}`,
        role: 'assistant',
        content: [{ type: 'text', text }],
        source: { kind: 'model' },
      },
    },
  }
}

test('reasoning blocks are not rendered, so a reader never pays for them', () => {
  const content = [
    { type: 'reasoning', text: 'PRIVATE DELIBERATION THAT MUST NOT BE READ' },
    { type: 'text', text: 'the answer' },
  ]
  assert.equal(textOfContent(content), 'the answer')
})

test('control sequences and newlines are stripped from rendered lines', () => {
  assert.equal(cleanLine('a\u001B[31mb\u001B[0m\nc\td'), 'ab c d')
  assert.equal(cleanLine('x\u202Ey'), 'xy')
})

test('only dialogue events render; bookkeeping events are dropped', () => {
  const events = [
    { seq: 0, type: 'turn/start', data: {} },
    userEvent(1, 'hello'),
    { seq: 2, type: 'step/start', data: {} },
    assistantEvent(3, 'hi'),
    { seq: 4, type: 'usage', data: { inputTokens: 10 } },
  ]
  const lines = linesOfEvents(events)
  assert.deepEqual(lines.map(line => line.seq), [1, 3])
  assert.deepEqual(lines.map(line => line.role), ['user', 'assistant'])
})

test('an injected user message is marked apart from a human one', () => {
  const human = lineOfEvent(userEvent(1, 'from a person', 'user'))
  const injected = lineOfEvent(userEvent(2, 'from the harness', 'system'))
  assert.equal(human.role, 'user')
  assert.equal(injected.role, 'user:system')
})

test('the tail keeps the NEWEST lines when the budget runs out', () => {
  const lines = Array.from({ length: 100 }, (_, index) => ({
    seq: index,
    role: 'user',
    type: 'user/message',
    text: `line-${String(index)}`,
  }))
  const tail = tailOf(lines, { maxChars: 40, maxLines: 100 })
  // Walking backward means the last line survives and the first does not.
  assert.ok(tail.lines.some(line => line.text === 'line-99'))
  assert.ok(!tail.lines.some(line => line.text === 'line-0'))
  assert.equal(tail.hasMore, true)
  assert.equal(tail.nextBeforeSeq, tail.fromSeq)
})

test('the tail returns lines in ascending seq order despite reading backward', () => {
  const lines = Array.from({ length: 20 }, (_, index) => ({
    seq: index,
    role: 'user',
    type: 'user/message',
    text: `x${String(index)}`,
  }))
  const tail = tailOf(lines, { maxChars: 10_000, maxLines: 5 })
  const seqs = tail.lines.map(line => line.seq)
  assert.deepEqual(seqs, [...seqs].sort((a, b) => a - b))
  assert.deepEqual(seqs, [15, 16, 17, 18, 19])
})

test('a line larger than the remaining budget is cut, not dropped', () => {
  const lines = [
    { seq: 0, role: 'tool', type: 'tool/result', text: 'old' },
    { seq: 1, role: 'tool', type: 'tool/result', text: 'Z'.repeat(5000) },
  ]
  const tail = tailOf(lines, { maxChars: 100, maxLines: 10 })
  assert.equal(tail.lines.length, 1)
  assert.equal(tail.lines[0].seq, 1)
  assert.equal(tail.lines[0].truncated, true)
  assert.equal(tail.lines[0].text.length, 100)
})

test('paging back with beforeSeq excludes what was already returned', () => {
  const lines = Array.from({ length: 10 }, (_, index) => ({
    seq: index,
    role: 'user',
    type: 'user/message',
    text: `l${String(index)}`,
  }))
  const first = tailOf(lines, { maxChars: 4, maxLines: 10 })
  const second = tailOf(lines, { maxChars: 4, maxLines: 10 }, first.nextBeforeSeq)
  assert.ok(second.toSeq < first.fromSeq)
  const overlap = second.lines.filter(line => first.lines.some(seen => seen.seq === line.seq))
  assert.deepEqual(overlap, [])
})

test('chunking never splits a line unless the line alone exceeds the budget', () => {
  const lines = Array.from({ length: 10 }, (_, index) => ({
    seq: index,
    role: 'user',
    type: 'user/message',
    text: 'y'.repeat(30),
  }))
  const chunks = chunkLines(lines, 100)
  assert.ok(chunks.length > 1)
  const flat = chunks.flat()
  assert.equal(flat.length, lines.length)
  assert.deepEqual(flat.map(line => line.seq), lines.map(line => line.seq))
  for (const chunk of chunks) {
    const size = chunk.reduce((total, line) => total + line.text.length + 1, 0)
    // Every chunk but a single-oversized-line chunk fits.
    assert.ok(size <= 100 || chunk.length === 1)
  }
})

test('a chunk boundary preserves order across the whole session', () => {
  const lines = Array.from({ length: 7 }, (_, index) => ({
    seq: index,
    role: 'user',
    type: 'user/message',
    text: 'z'.repeat(10),
  }))
  const chunks = chunkLines(lines, 25)
  const seqs = chunks.flat().map(line => line.seq)
  assert.deepEqual(seqs, [0, 1, 2, 3, 4, 5, 6])
})

test('the compaction prompt names the seq range so a summary stays traceable', () => {
  const chunk = [
    { seq: 10, role: 'user', type: 'user/message', text: 'a' },
    { seq: 11, role: 'assistant', type: 'assistant/message', text: 'b' },
  ]
  const prompt = compactPrompt(chunk, 'sess-1')
  assert.match(prompt.user, /seq 10\.\.11/)
  assert.match(prompt.user, /sess-1/)
  assert.match(prompt.instruction, /Never invent a fact/)
})

test('the assembled map keeps the NEWEST summaries under its budget', () => {
  const summaries = ['oldest', 'middle', 'newest']
  const assembled = assembleMap(summaries, 14)
  // 14 chars fits 'newest' and 'middle' but not all three.
  assert.ok(assembled.text.includes('newest'))
  assert.ok(!assembled.text.includes('oldest'))
  assert.equal(assembled.dropped, 1)
})

test('ranking explains itself and puts a title match above a body match', () => {
  const sessions = [
    { id: 'a', title: 'broker budget' },
    { id: 'b', title: 'unrelated' },
  ]
  const bodies = new Map([['b', 'we discussed the broker budget at length']])
  const ranked = rankSessions(sessions, 'broker budget', bodies)
  assert.equal(ranked[0].session.id, 'a')
  assert.match(ranked[0].why, /title/)
  assert.match(ranked[1].why, /body hit/)
})

test('an empty query ranks everything rather than nothing', () => {
  const ranked = rankSessions([{ id: 'a' }, { id: 'b' }], '')
  assert.equal(ranked.length, 2)
})

test('the default budget is the documented one', () => {
  assert.equal(DEFAULT_READ_BUDGET.maxChars, 24_000)
  assert.equal(DEFAULT_READ_BUDGET.maxLines, 400)
})
