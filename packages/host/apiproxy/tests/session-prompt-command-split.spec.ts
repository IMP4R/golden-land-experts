/**
 * Slash-command admission split for `session.prompt`: a prompt whose content is
 * exactly one text block starting with `/` executes through the command
 * registry and never becomes a durable human message (api/sessions.ts
 * documents this contract). Every other shape keeps the human admission path.
 */

import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import type { Agent } from '@deepseek-ai/dsh-agent'
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm'
import type { LlmModelInfo } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import SessionStore from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import UserQuestionService from '@deepseek-ai/dsh-user-questions'
import type { RpcRequest } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { RpcId } from '@deepseek-ai/dsh-host-apiproxy/api/rpc'
import { createApiProxy } from '../src/api-proxy.ts'

let nextRpc = 1
function request<P>(payload: P): RpcRequest<P> {
  return { rpcId: RpcId(`cmd-split-${String(nextRpc++)}`), payload }
}

class CatalogAdapter extends LlmAdapter {
  constructor(private readonly name: string, private readonly models: readonly LlmModelInfo[]) {
    super()
  }

  override providerInfo(provider: string): { id: string; name: string } {
    return { id: provider, name: this.name }
  }

  override listModels(): Promise<readonly LlmModelInfo[]> {
    return Promise.resolve(this.models)
  }

  override async *stream(): AsyncIterable<never> {
    throw new Error('CatalogAdapter does not stream model responses')
  }
}

async function harness(): Promise<{
  ctx: Context
  agent: Agent
  sessionId: SessionId
}> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SystemPrompt, { persona: '' })
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(UserQuestionService)
  await ctx.plugin(AgentRegistry)
  ctx.llm.registerAdapter(['deepseek-official'], new CatalogAdapter('DeepSeek', [
    { provider: 'deepseek-official', id: 'deepseek-chat', name: 'DeepSeek Chat' },
  ]))
  const session = ctx.sessions.create()
  const agent = {
    id: session.id,
    session,
    status: 'running',
    ctx,
    inbox: { nextTurn: [], nextStep: [] },
  } as unknown as Agent
  ctx.agents.register(agent)
  return { ctx, agent, sessionId: session.id }
}

describe('session.prompt slash-command admission', () => {
  it('dispatches a leading-/ single-text prompt through the command registry without a durable human message', async () => {
    const { ctx, agent, sessionId } = await harness()
    const execute = vi.fn((_sessionId: SessionId, _line: string, _args: readonly string[]) => Promise.resolve({
      commandId: 'command-1',
      result: { kind: 'success' as const, text: 'Compaction finished.' },
    }))
    ctx.provide('commands', { execute, find: () => undefined } as never)
    const followup = vi.fn()
    const steer = vi.fn()
    Object.assign(agent, { followup, steer })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '/compact' }],
    }))
    expect(result.result.ok).toBe(true)
    expect(result.result).toMatchObject({
      value: { accepted: true, command: { kind: 'success', text: 'Compaction finished.' } },
    })
    expect(execute).toHaveBeenCalledOnce()
    expect(execute.mock.calls[0]?.[1]).toBe('/compact')
    expect(followup).not.toHaveBeenCalled()
    expect(steer).not.toHaveBeenCalled()
    expect(agent.session.events.filter(event => event.type === 'user/message')).toEqual([])
  })

  it('rejects an unrecognized leading-/ prompt with unknown-command and no durable message', async () => {
    const { ctx, agent, sessionId } = await harness()
    ctx.provide('commands', { execute: () => Promise.resolve(undefined) } as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '/definitely-not-registered' }],
    }))
    expect(result.result.ok).toBe(false)
    if (!result.result.ok) expect(result.result.error.code).toBe('unknown-command')
    expect(followup).not.toHaveBeenCalled()
  })

  it('surfaces a command error result as command-error without admitting a human turn', async () => {
    const { ctx, agent, sessionId } = await harness()
    ctx.provide('commands', {
      execute: () => Promise.resolve({ commandId: 'command-2', result: { kind: 'error' as const, text: 'No compactable history yet.' } }),
    } as never)
    const followup = vi.fn()
    Object.assign(agent, { followup })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const result = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '/compact' }],
    }))
    expect(result.result.ok).toBe(false)
    if (!result.result.ok) {
      expect(result.result.error.code).toBe('command-error')
      expect(result.result.error.message).toBe('No compactable history yet.')
    }
    expect(followup).not.toHaveBeenCalled()
  })

  it('keeps ordinary multi-part and non-slash prompts on the human admission path', async () => {
    const { ctx, agent, sessionId } = await harness()
    const executedLines: string[] = []
    ctx.provide('commands', {
      execute: (_agent: unknown, line: string) => {
        executedLines.push(String(line))
        return Promise.resolve(undefined)
      },
    } as never)
    let followupCount = 0
    Object.assign(agent, { followup: () => { followupCount += 1 } })
    const api = createApiProxy(ctx, {
      defaultModelSelection: () => ({ provider: 'deepseek-official', model: 'deepseek-chat' }),
      cwd: '/tmp',
    })

    const plain = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: 'say /compact inside a sentence' }],
    }))
    expect(plain.result.ok).toBe(true)
    expect(executedLines).toEqual([])
    expect(followupCount).toBe(1)

    // A leading-/ line with arguments is still a command: the whole line is
    // dispatched and the command owns argument parsing.
    const withArgs = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [{ type: 'text' as const, text: '/compact args after the name' }],
    }))
    expect(withArgs.result.ok).toBe(false)
    if (!withArgs.result.ok) expect(withArgs.result.error.code).toBe('unknown-command')
    expect(executedLines).toEqual(['/compact args after the name'])
    expect(followupCount).toBe(1)

    const multi = await api.sessions.prompt(request({
      sessionId,
      mode: 'queue' as const,
      content: [
        { type: 'text' as const, text: '/compact' },
        { type: 'text' as const, text: 'second block' },
      ],
    }))
    expect(multi.result.ok).toBe(true)
    expect(executedLines).toEqual(['/compact args after the name'])
    expect(followupCount).toBe(2)
  })
})
