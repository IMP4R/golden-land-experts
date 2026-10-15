/**
 * Agent-scoped model selection shared by runtime entry points.
 * @module @deepseek-ai/dsh-agent/model-selection
 */

import type { Context } from '@deepseek-ai/cordis'
import type { LlmCallConfig, ReasoningEffortId } from '@deepseek-ai/dsh-llm'

/** Complete provider, model, and optional reasoning effort selected for one live Agent. */
export interface ModelSelection {
  /** Registered provider route. */
  provider: string
  /** Provider-owned model id. */
  model: string
  /** Adapter-owned reasoning effort, or provider/default behavior when absent. */
  reasoningEffort?: ReasoningEffortId
}

/** Mutable model selection plus the value captured for the current step. */
export interface ModelSelectionRef {
  /** Model selected for the next step that enters prompt assembly. */
  current: ModelSelection | undefined
  /** Selection captured when the current step entered prompt assembly. */
  assembled: ModelSelection | undefined
}

const LIVE_SELECTION = Symbol.for('dsh.agent.liveModelSelection')

/**
 * Record the process-local Web/API selection on the Agent so children can
 * inherit the route the parent is actually assembling, not only `options`.
 * @param agent - live parent agent.
 * @param selection - mutable selection installed by the entry point.
 */
export function bindLiveModelSelection(agent: AgentLike, selection: ModelSelectionRef): void {
  Object.defineProperty(agent, LIVE_SELECTION, {
    value: selection,
    configurable: true,
    enumerable: false,
    writable: false,
  })
}

/**
 * Read the parent's currently selected or last assembled model.
 * Prefer `current` so a picker change before the next parent step still
 * reaches a child spawned in this turn. Fall back to `assembled`, then none.
 * @param agent - parent whose live selection may have been bound.
 * @returns the live selection, or undefined when the parent has none.
 */
export function liveModelSelectionOf(agent: AgentLike): ModelSelection | undefined {
  const bound = (agent as { [LIVE_SELECTION]?: ModelSelectionRef })[LIVE_SELECTION]
  if (bound === undefined) return undefined
  return bound.current ?? bound.assembled
}

/** Minimal agent face used by live-selection helpers. */
interface AgentLike {
  readonly options: { provider?: string; model?: string; maxTokens?: number }
}

/**
 * Couple one mutable selection to Agent-scoped prompt assembly and request routing.
 * Prompt assembly snapshots the selected model before delegating, then applies
 * its provider/model pair and effort to request config so a
 * concurrent switch takes effect on a later step instead of splitting the two
 * surfaces. An absent selected effort clears any inherited effort, restoring
 * the selected model's provider/default behavior.
 *
 * @param agentCtx - The selected Agent's scoped context.
 * @param selection - Mutable selection owned by the calling entry point.
 * @returns Disposer for both scoped waterfall listeners.
 */
export function installModelSelection(agentCtx: Context, selection: ModelSelectionRef): () => void {
  if (agentCtx.agent !== undefined) bindLiveModelSelection(agentCtx.agent, selection)
  const disposeAssembly = agentCtx.on('system-prompt/assemble', async (_assembly, _context, next) => {
    const selected = selection.current
    const assembled = await next()
    selection.assembled = selected
    if (selected === undefined) return assembled
    return {
      ...assembled,
      variables: {
        ...assembled.variables,
        provider: selected.provider,
        model: selected.model,
      },
    }
  })
  const disposeRequest = agentCtx.on(
    'agent/request',
    async (_payload, next): Promise<LlmCallConfig> => {
      const resolved = await next()
      const selected = selection.assembled
      if (selected === undefined) return resolved
      const { reasoningEffort: _inheritedEffort, ...withoutInheritedEffort } = resolved
      return {
        ...withoutInheritedEffort,
        provider: selected.provider,
        model: selected.model,
        ...selected.reasoningEffort === undefined
          ? {}
          : { reasoningEffort: selected.reasoningEffort },
      }
    },
  )
  return () => {
    disposeAssembly()
    disposeRequest()
  }
}
