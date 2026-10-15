import { describe, expect, it } from 'vitest'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import {
  BROKER_BUDGET,
  clipCapsuleText,
  estimateTokens,
  isHumanUserMessage,
  latestHumanMessage,
  packBrokerInput,
} from '../src/broker.ts'
import { canCancelEpisode, expertById, ExpertPool } from '../src/experts.ts'
import { isGreetingQuery, overlapScore, selectRelevant } from '../src/candidates.ts'
import { isPluginRecallDump, readHistory, searchHistory } from '../src/history.ts'
import { activeRoute, applyPickerToActive, resolveExecutionRoute, setActiveKind } from '../src/routes.ts'
import type { WitchModelRoutes } from '../src/types.ts'

const routes: WitchModelRoutes = {
  cheap: { provider: 'cheapvibecode', model: 'glm-5.3-flash' },
  expensive: { provider: 'cheapvibecode', model: 'gpt-6-astra' },
  active: 'cheap',
}

describe('Memory Broker selection', () => {
  const hits = [
    { id: 'c1', kind: 'claim' as const, text: 'Webhook idempotency uses a unique constraint on delivery id.' },
    { id: 'c2', kind: 'claim' as const, text: 'Yarn Loop bobbin capacity depletes on matching stitches.' },
  ]

  it('returns no semantic memory for a greeting', () => {
    expect(isGreetingQuery('привет. как дела?')).toBe(true)
    expect(selectRelevant('привет. как дела?', hits)).toEqual([])
  })

  it('keeps overlapping project memory for a topical request', () => {
    const selected = selectRelevant('fix webhook double charge idempotency', hits)
    expect(selected.map(hit => hit.id)).toEqual(['c1'])
    expect(overlapScore('webhook', hits[0]!.text)).toBeGreaterThan(0)
  })
})

describe('Memory Broker packing', () => {
  it('keeps HANDOFF §11 section budgets: 400/600/2400/1600 = 5000', () => {
    const packed = packBrokerInput({
      humanMessageId: 'h1',
      humanText: 'fix webhook double charge',
      contract: 'scope: payments',
      tail: 'recent relevant tail '.repeat(400),
      candidates: Array.from({ length: 40 }, (_, i) => ({
        id: `c${i}`,
        kind: 'claim' as const,
        text: `unrelated hit ${i} `.repeat(80),
      })),
    })
    expect(packed.tokens).toBeLessThanOrEqual(BROKER_BUDGET.total)
    expect(packed.parts.instruction).toBeLessThanOrEqual(BROKER_BUDGET.instruction)
    expect(packed.parts.task).toBeLessThanOrEqual(BROKER_BUDGET.task)
    expect(packed.parts.tail).toBeLessThanOrEqual(BROKER_BUDGET.tail)
    expect(packed.parts.candidates).toBeLessThanOrEqual(BROKER_BUDGET.candidates)
    expect(packed.packed).toContain('HUMAN:')
    expect(packed.packed).toContain('Select only memory')
    expect(BROKER_BUDGET.instruction + BROKER_BUDGET.task + BROKER_BUDGET.tail + BROKER_BUDGET.candidates)
      .toBe(BROKER_BUDGET.total)
    expect(BROKER_BUDGET.output).toBe(300)
  })

  it('allows an empty capsule and clips oversized filter output', () => {
    expect(clipCapsuleText('', 300)).toBe('')
    const huge = 'x'.repeat(10_000)
    expect(estimateTokens(clipCapsuleText(huge, 300))).toBeLessThanOrEqual(300)
  })

  it('selects only authentic human user messages', () => {
    const plugin = createUserMessage({
      content: [{ type: 'text', text: 'Graphiti memory dump' }],
      source: { kind: 'plugin', plugin: 'golden-land-graphiti-lifecycle' },
    })
    const human = createUserMessage({
      content: [{ type: 'text', text: 'real request' }],
      source: { kind: 'user' },
    })
    const messages: Message[] = [plugin, human]
    expect(isHumanUserMessage(plugin)).toBe(false)
    expect(isHumanUserMessage(human)).toBe(true)
    expect(latestHumanMessage(messages)).toBe(human)
    expect(latestHumanMessage([plugin])).toBeUndefined()
  })
})

describe('dual routes', () => {
  it('writes the picker onto the active slot only', () => {
    const next = applyPickerToActive(routes, { provider: 'cheapvibecode', model: 'grok-4.6' })
    expect(next.cheap.model).toBe('grok-4.6')
    expect(next.expensive.model).toBe('gpt-6-astra')
  })

  it('toggles assembly without rewriting the other slot', () => {
    const expensive = setActiveKind(routes, 'expensive')
    expect(activeRoute(expensive).model).toBe('gpt-6-astra')
    expect(expensive.cheap.model).toBe('glm-5.3-flash')
  })

  it('never silently promotes cheap failure to expensive', () => {
    expect(resolveExecutionRoute(routes, 'cheap')).toEqual(routes.cheap)
    expect(resolveExecutionRoute(routes, 'expensive').model).toBe('gpt-6-astra')
  })
})

describe('shared experts', () => {
  const experts = [{ id: 'payments', title: 'Payments', scope: 'payments', tools: 'payments-dev' }]

  it('looks up passports and isolates cancel rights', () => {
    expect(expertById(experts, 'payments')?.title).toBe('Payments')
    expect(canCancelEpisode({
      witchSessionId: 'witch-a',
    }, 'witch-a')).toBe(true)
    expect(canCancelEpisode({
      witchSessionId: 'witch-a',
    }, 'witch-b')).toBe(false)
  })

  it('lets two witches share competence without mixing private episodes', () => {
    const pool = new ExpertPool(experts, {
      payments: [{
        id: 'm1',
        text: 'Webhook idempotency uses a unique constraint on delivery id so a replay does not change the balance.',
        status: 'verified',
      }],
    })
    const a = pool.ask('witch-a', 'payments', 'context', 'goal: webhook idempotency\nscope: payments')
    const b = pool.ask('witch-b', 'payments', 'execute', [
      'goal: prevent webhook double charge',
      'scope: payments',
      'accept:',
      '  - First delivery credits once',
      '  - Replay does not change the balance',
    ].join('\n'))
    expect(a.route.model).toBe('glm-5.3-flash')
    expect(b.route.model).toBe('glm-5.3-flash')
    expect(a.status).toBe('completed')
    expect(b.status).toBe('completed')
    expect(b.message?.type).toBe('result')
    expect(b.message?.checks).toMatch(/PASS/)
    expect(pool.episodesOf('payments')).toHaveLength(2)
    expect(() => pool.cancel(a.id, 'witch-b')).toThrow(/own expert episode/)
    expect(pool.cancel(a.id, 'witch-a').status).toBe('cancelled')
    expect(pool.inspect(b.id)?.status).toBe('completed')
  })

  it('pauses and resumes an owned episode without touching the other witch', () => {
    const pool = new ExpertPool(experts, {
      payments: [{ id: 'm1', text: 'unique constraint delivery', status: 'verified' }],
    })
    const a = pool.ask('witch-a', 'payments', 'execute', [
      'goal: webhook unique constraint',
      'scope: payments',
      'stop_if:',
      '  - Need a production migration',
    ].join('\n'))
    expect(a.status).toBe('waiting')
    const paused = pool.pause(a.id, 'witch-a')
    expect(paused.status).toBe('paused')
    const other = pool.ask('witch-b', 'payments', 'context', 'goal: webhook unique constraint\nscope: payments')
    expect(other.status).toBe('completed')
    const resumed = pool.resume(a.id, 'witch-a')
    expect(resumed.version).toBeGreaterThan(paused.version)
    expect(pool.inspect(other.id)?.status).toBe('completed')
  })
})

describe('compaction restore copy', () => {
  it('states that the checkpoint does not replace the system prompt', async () => {
    const { COMPACTION_SYSTEM_RESTORE } = await import('../src/history.ts')
    expect(COMPACTION_SYSTEM_RESTORE).toContain('does not replace the system prompt')
  })
})

describe('external history', () => {
  const records = [
    { id: 'h1', startSeq: 1, endSeq: 4, text: 'webhook idempotency unique constraint' },
    { id: 'h2', startSeq: 5, endSeq: 9, text: 'unrelated canvas gesture notes' },
  ]

  it('searches by substring and caps hits', () => {
    expect(searchHistory(records, 'IDEMPOTENCY').map(r => r.id)).toEqual(['h1'])
    expect(searchHistory(records, '   ')).toEqual([])
  })

  it('reads a bounded fragment', () => {
    const got = readHistory(records, 'h1', 0, 8)
    expect(got?.text).toBe('webhook ')
    expect(got?.truncated).toBe(true)
  })

  it('recognizes plugin recall dumps', () => {
    expect(isPluginRecallDump('<system-reminder>Memory Broker capsule')).toBe(true)
    expect(isPluginRecallDump('fix the webhook')).toBe(false)
  })
})
