import { Context } from '@deepseek-ai/cordis'
import type { Agent, CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { liveModelSelectionOf } from '@deepseek-ai/dsh-agent'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import { AgentCycleProvider } from '../src/agent-cycle-provider.ts'
import type { StageRequest } from '../src/cycle-runner.ts'

function fixture(reason = 'completed') {
  const events = [
    { type: 'turn/start', data: { turn: 1 } },
    { type: 'step/start', data: { turn: 1, step: 1 } },
    { type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '{"role":"collector","facts":["file:1"]}' }] } } },
    { type: 'turn/end', data: { turn: 1, reason: { kind: reason } } },
  ] as unknown as SessionEvent[]
  let disposed = 0
  let driven = false
  let options: CreateAgentOptions | undefined
  const child = { options: {}, session: { events }, followup: () => { driven = true }, whenIdle: async () => {}, cancel: () => {} } as unknown as Agent
  const scope = new Context()
  Object.defineProperty(scope, 'agent', { value: child })
  const ctx = { agents: { create: async (next: CreateAgentOptions) => {
    options = next
    await next.setup?.(scope)
    return { agent: child, dispose: async () => { disposed += 1 } }
  } } } as unknown as Context
  const parent = { session: { id: 'witch', header: { cwd: '/fixture', delegationDepth: 0 } } } as unknown as Agent
  const request: StageRequest = { role: 'collector', goal: 'inspect', version: 1, facts: [], results: [], signal: new AbortController().signal, route: { provider: 'cheap', model: 'worker' }, bind: agent => {
    expect(agent).toBe(child)
    expect(driven).toBe(false)
    expect(liveModelSelectionOf(agent)).toEqual({ provider: 'cheap', model: 'worker' })
  } }
  return { adapter: new AgentCycleProvider(ctx, parent, 'execution'), request, disposed: () => disposed, options: () => options }
}

describe('AgentCycleProvider', () => {
  it('binds explicit route and grant before driving and drains the handle', async () => {
    const f = fixture()
    expect(await f.adapter.run(f.request)).toEqual({ role: 'collector', facts: ['file:1'] })
    expect(f.options()?.meta?.agentPreset).toBe('execution')
    expect(f.options()?.agentOptions).toEqual({ provider: 'cheap', model: 'worker' })
    expect(f.disposed()).toBe(1)
  })
  it('does not accept partial JSON from failed or truncated turns', async () => {
    for (const reason of ['error', 'aborted', 'max-tokens']) {
      const f = fixture(reason)
      await expect(f.adapter.run(f.request)).rejects.toThrow('did not complete')
      expect(f.disposed()).toBe(1)
    }
  })
})
