import { registerRlm, RlmJournal } from './rlm.js'

export const name = 'witches-rlm'
export const inject = ['tools', 'subagents', 'witches-durable-history']
export const provide = 'witches-rlm'

/** Registers the Code Mode RLM namespace after required services are available. */
export function apply(ctx, config) {
  const history = ctx['witches-durable-history']
  if (!history) throw new Error('witches-rlm requires witches-durable-history service')
  const experts = history.experts || []
  const sessionFor = agent => String(agent.session?.id || agent.id)
  const spawnExpert = async (exec, expert, contract, context) => {
    const sessionId = sessionFor(exec.agent)
    const routes = await history.expertRoute?.(sessionId)
    return ctx.subagents.start('spawn', {
      label: `rlm:${expert.id}`,
      prompt: [{ type: 'text', text: `Expert ${expert.id}. Contract: ${JSON.stringify(contract)}\nRLM context variable: ${context}` }],
      parent: exec.agent,
      signal: exec.signal,
      agentOptions: routes ? { provider: routes.resolvedProvider, model: routes.resolvedModel } : undefined,
      persona: `Shared ${expert.title} expert. No inherited witch conversation. No recursive RLM spawn.`,
      toolFilter: { deny: ['rlm_spawn', 'expert_ask', 'expert_pause', 'expert_resume', 'expert_cancel'] },
      maxDepth: 1,
    })
  }
  const registered = registerRlm(ctx, {
    history,
    journal: new RlmJournal(config?.root),
    limits: config?.limits,
    experts,
    spawnExpert,
    nativeTools: config?.codeMode !== true,
  })
  ctx.effect(() => () => registered.dispose(), 'witches-rlm: tools')
}
