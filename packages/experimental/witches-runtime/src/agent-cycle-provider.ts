/** In-process stage adapter using the AgentRegistry creation transaction. */
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { foldConsumedWork, installModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { finalAssistantOutput } from '@deepseek-ai/dsh-subagent'
import type { CycleProvider, StageRequest, StageResult } from './cycle-runner.ts'
import { parseStageResult } from './stage-result.ts'

/** Creates stage agents with a dedicated preset, explicit route, and pre-publication grant. */
export class AgentCycleProvider implements CycleProvider {
  /** The owner supplies the isolated execution preset; never inherit a human-dialogue preset. */
  constructor(private readonly ctx: Context, private readonly parent: Agent, private readonly preset: string) {
    if (!preset.trim()) throw new Error('Execution preset required')
  }

  /** Executes one isolated child turn and validates its final reply before teardown. */
  async run(request: StageRequest): Promise<StageResult> {
    const handle = await this.ctx.agents.create({
      sessionId: SessionId(randomUUID()),
      meta: { ...(this.parent.session.header.cwd ? { cwd: this.parent.session.header.cwd } : {}), parentSession: this.parent.session.id, origin: 'subagent', delegationDepth: (this.parent.session.header.delegationDepth ?? 0) + 1, agentPreset: this.preset },
      agentOptions: { provider: request.route.provider, model: request.route.model },
      signal: request.signal,
      setup: childCtx => {
        const agent = childCtx.agent
        if (!agent) throw new Error('Stage creation did not provide an Agent')
        installModelSelection(childCtx, { current: { ...request.route }, assembled: undefined })
        request.bind(agent)
      },
    })
    const child = handle.agent
    const cancel = (): void => { child.cancel({ kind: 'parent' }) }
    request.signal.addEventListener('abort', cancel, { once: true })
    try {
      request.signal.throwIfAborted()
      const payload = { role: request.role, goal: request.goal, facts: request.facts, assignment: request.assignment, results: request.results }
      const replies = {
        collector: '{"role":"collector","facts":["file paths, observed facts and evidence references"]}',
        planner: '{"role":"planner","assignments":[{"id":"w1","goal":"bounded change","scope":"absolute permitted root","accept":["checks"],"allowedTools":["read","edit"],"calls":12}]}',
        worker: '{"role":"worker","evidence":["changed files and executed checks with results"]}',
        reviewer: '{"role":"reviewer","accepted":false,"evidence":["observed checks and reasons; do not trust worker claims alone"]}',
      }
      child.followup(createUserMessage({ source: { kind: 'plugin', plugin: 'witches-cycle' }, content: [{ type: 'text', text: `Execute only your assigned stage. Inspection stages must not mutate. Workers remain within their assignment. Return one JSON object, no markdown or extra prose. Expected fields: ${replies[request.role]}\nTask: ${JSON.stringify(payload)}` }] }))
      await child.whenIdle()
      request.signal.throwIfAborted()
      const reason = foldConsumedWork(child.session.events).end?.data.reason
      if (reason?.kind !== 'completed') throw new Error(`Stage did not complete: ${reason?.kind ?? 'no turn end'}`)
      const output = finalAssistantOutput(child.session.events)
      if (!output) throw new Error('Stage produced no final assistant result')
      const raw = output.filter(block => block.type === 'text').map(block => block.text).join('\n')
      return parseStageResult(raw)
    } finally {
      request.signal.removeEventListener('abort', cancel)
      await handle.dispose()
    }
  }
}
