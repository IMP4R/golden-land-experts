import { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { CodeRuntime, type CodeRunRequest, type CodeRunResult } from '@deepseek-ai/dsh-code-runtime'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { describe, expect, it } from 'vitest'
import { ExecutionCycle } from '../src/execution-cycle.ts'
import { installExecutionGuard, type ExecutionGrant } from '../src/execution-guard.ts'

class ProbeRuntime extends CodeRuntime {
  readonly language = 'typescript'
  readonly isolation = 'test'
  calls = 0
  constructor(ctx: Context) { super(ctx) }
  async run(_request: CodeRunRequest): Promise<CodeRunResult> { this.calls += 1; return { logs: [] } }
}

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  const executed: string[] = []
  for (const name of ['read', 'edit', 'bash', 'subagent', 'unknown_extension']) {
    ctx.tools.register(defineTool({
      name, description: name, parameters: { file_path: { type: 'string' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      execute: async () => { executed.push(name); return name },
    }))
  }
  const agent = { session: { header: { cwd: process.cwd() } } } as Agent
  const cycle = new ExecutionCycle('witch', 'repair fixture')
  let grant: ExecutionGrant | undefined
  const dispose = installExecutionGuard(ctx, caller => caller === agent ? grant : undefined)
  const call = (name: string) => ctx.tools.execute({ agent, callId: CallId(`call-${name}`), name, arguments: { file_path: 'fixture.txt' }, signal: new AbortController().signal })
  return { ctx, cycle, executed, dispose, call, setGrant: (value: ExecutionGrant) => { grant = value } }
}

describe('installExecutionGuard executor policy', () => {
  it('blocks real run_code transport before runtime execution', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime, { mode: 'both' })
    await ctx.plugin(ProbeRuntime)
    const runtime = ctx.codeRuntime as ProbeRuntime
    installExecutionGuard(ctx, () => undefined)
    const result = await ctx.tools.execute({ agent: {} as Agent, callId: CallId('code-call'), name: 'run_code', arguments: { code: 'return 1', description: 'probe' }, signal: new AbortController().signal })
    expect(result.isError).toBe(true)
    expect(runtime.calls).toBe(0)
    await ctx.fiber.dispose()
  })

  it('denies unauthorised tools before their handlers run', async () => {
    const s = await setup()
    for (const tool of ['edit', 'bash', 'subagent', 'unknown_extension']) expect((await s.call(tool)).isError).toBe(true)
    expect(s.executed).toEqual([])
    await s.ctx.fiber.dispose()
  })

  it('collector is read-only, including alternate shell and code paths', async () => {
    const s = await setup()
    s.setGrant({ cycle: s.cycle, authority: { owner: 'witch', version: 1, role: 'collector' } })
    expect((await s.call('read')).isError).toBe(false)
    for (const tool of ['edit', 'bash', 'subagent']) expect((await s.call(tool)).isError).toBe(true)
    expect(s.executed).toEqual(['read'])
    await s.ctx.fiber.dispose()
  })

  it('worker reserves the call budget and pause denies already issued grants', async () => {
    const s = await setup()
    s.cycle.submitFacts({ owner: 'witch', version: 1, role: 'collector' }, ['artifact:inspection'])
    s.cycle.submitPlan({ owner: 'witch', version: 1, role: 'planner' }, [{ id: 'w1', goal: 'repair', scope: process.cwd(), accept: ['check'], allowedTools: ['edit'], calls: 1 }])
    s.setGrant({ cycle: s.cycle, assignmentId: 'w1', authority: { owner: 'witch', version: 1, role: 'worker' } })
    expect((await s.call('bash')).isError).toBe(true)
    expect((await s.call('edit')).isError).toBe(false)
    expect((await s.call('edit')).isError).toBe(true)
    s.cycle.pause('witch')
    expect((await s.call('edit')).isError).toBe(true)
    expect(s.executed).toEqual(['edit'])
    await s.ctx.fiber.dispose()
  })

  it('disposal removes the hook rather than leaving a stale policy', async () => {
    const s = await setup()
    expect((await s.call('edit')).isError).toBe(true)
    s.dispose()
    expect((await s.call('edit')).isError).toBe(false)
    expect(s.executed).toEqual(['edit'])
    await s.ctx.fiber.dispose()
  })
})
