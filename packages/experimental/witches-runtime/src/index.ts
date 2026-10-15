/**
 * Witch dual-route, Memory Broker, and shared expert registry.
 * @module @deepseek-ai/dsh-experimental-witches-runtime
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { createUserMessage, type Message } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-agent'
import {
  capsuleReminder,
  clipCapsuleText,
  latestHumanMessage,
  packBrokerInput,
  textOf,
  type MemoryCandidate,
} from './broker.ts'
import { ExpertPool, type ExpertEpisode } from './experts.ts'
import { activeRoute, applyPickerToActive, setActiveKind } from './routes.ts'
import type {
  Config, ExpertPassport, MemoryCapsule, WitchModelRoutes, WitchRoute, WitchRouteKind,
} from './types.ts'

export type * from './types.ts'
export { ExecutionCycle } from './execution-cycle.ts'
export { CycleRunner } from './cycle-runner.ts'
export { AgentCycleProvider } from './agent-cycle-provider.ts'
export { parseStageResult } from './stage-result.ts'
export type { CycleProvider, StageRequest, StageResult } from './cycle-runner.ts'
export type { CycleAuthority, CyclePhase, WorkerAssignment } from './execution-cycle.ts'
export { installExecutionGuard } from './execution-guard.ts'
export type { ExecutionGrant } from './execution-guard.ts'
export {
  BROKER_BUDGET, BROKER_FILTER_INSTRUCTION, capsuleReminder, clipCapsuleText,
  clipToTokens, estimateTokens, isHumanUserMessage, latestHumanMessage,
  packBrokerInput, textOf,
} from './broker.ts'
export { activeRoute, applyPickerToActive, resolveExecutionRoute, setActiveKind } from './routes.ts'
export { canCancelEpisode, expertById, ExpertPool, parseContract } from './experts.ts'
export type { DomainFact, EpisodeStatus, ExpertEpisode, ExpertMessage, TaskContract } from './experts.ts'
export { WitchRouteStore } from './route-store.ts'
export {
  budgetCandidates, isGreetingQuery, loadLedgerCandidates, overlapScore, selectRelevant,
} from './candidates.ts'
export {
  COMPACTION_SYSTEM_RESTORE, isPluginRecallDump, readHistory, searchHistory,
} from './history.ts'
export type { HistoryRecord } from './history.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    witches: WitchesRuntime
  }
}

const DEFAULT_EXPERTS: ExpertPassport[] = [
  { id: 'code', title: 'Code', scope: 'implementation', tools: 'dev' },
  { id: 'research', title: 'Research', scope: 'investigation', tools: 'research' },
  { id: 'memory', title: 'Memory', scope: 'durable-knowledge', tools: 'memory' },
]

/** Validate a positive safe-integer limit. */
function positiveLimit(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`witches-runtime: ${name} must be a positive safe integer`)
  }
  return value
}

/** Host service for dual routes, Memory Broker, and experts. */
export class WitchesRuntime extends Service {
  static Config: z<Config> = z.object({
    brokerInputTokens: z.number().default(5000),
    brokerOutputTokens: z.number().default(300),
    cheapProvider: z.string().default('cheapvibecode'),
    cheapModel: z.string().default('glm-5.3-flash'),
    expensiveProvider: z.string().default('cheapvibecode'),
    expensiveModel: z.string().default('gpt-6-astra'),
    experts: z.array(z.object({
      id: z.string().required(),
      title: z.string().required(),
      scope: z.string().required(),
      tools: z.string().default(''),
    })).default(DEFAULT_EXPERTS as never),
  })

  private readonly brokerInputTokens: number
  private readonly brokerOutputTokens: number
  private readonly defaults: WitchModelRoutes
  readonly experts: readonly ExpertPassport[]
  readonly pool: ExpertPool
  private readonly capsules = new Map<string, MemoryCapsule>()

  constructor(ctx: Context, config: Config) {
    super(ctx, 'witches')
    this.brokerInputTokens = positiveLimit('brokerInputTokens', config.brokerInputTokens)
    this.brokerOutputTokens = positiveLimit('brokerOutputTokens', config.brokerOutputTokens)
    this.defaults = {
      cheap: { provider: config.cheapProvider, model: config.cheapModel },
      expensive: { provider: config.expensiveProvider, model: config.expensiveModel },
      active: 'cheap',
    }
    this.experts = config.experts
    this.pool = new ExpertPool(this.experts)
    ctx.on('agent/pre-step', async ({ signal }, next) => {
      const decision = await next()
      try {
        if (decision?.kind !== 'enter' || signal.aborted) return decision
        return await this.injectCapsule(decision)
      } catch (error: unknown) {
        ctx.logger?.warn?.(`witches-runtime: broker degraded: ${String((error as Error)?.message ?? error)}`)
        return decision
      }
    })
  }

  /**
   * Default dual routes before a witch stores its own pair.
   * @returns cloned defaults.
   */
  defaultRoutes(): WitchModelRoutes {
    return {
      cheap: { ...this.defaults.cheap },
      expensive: { ...this.defaults.expensive },
      active: this.defaults.active,
    }
  }

  /**
   * Route the witch itself should assemble.
   * @param routes - stored dual routes.
   */
  witchAssemblyRoute(routes: WitchModelRoutes): WitchRoute {
    return activeRoute(routes)
  }

  /**
   * Apply a composer picker selection onto the active dual-route slot.
   * @param routes - stored dual routes.
   * @param selected - picker result.
   */
  recordPicker(routes: WitchModelRoutes, selected: WitchRoute): WitchModelRoutes {
    return applyPickerToActive(routes, selected)
  }

  /**
   * Switch cheap/expensive without rewriting the inactive slot.
   * @param routes - stored dual routes.
   * @param kind - requested kind.
   */
  switchKind(routes: WitchModelRoutes, kind: WitchRouteKind): WitchModelRoutes {
    return setActiveKind(routes, kind)
  }

  /**
   * Open an isolated expert episode owned by one witch.
   * @param witchSessionId - requesting witch.
   * @param expertId - shared expert.
   * @param mode - context, consult, or execute.
   * @param contract - task contract.
   */
  openEpisode(
    witchSessionId: string,
    expertId: string,
    mode: ExpertEpisode['mode'],
    contract: string,
  ): ExpertEpisode {
    return this.pool.ask(witchSessionId, expertId, mode, contract)
  }

  /**
   * Cancel an episode if the witch owns it.
   * @param episodeId - episode.
   * @param witchSessionId - requesting witch.
   */
  cancelEpisode(episodeId: string, witchSessionId: string): boolean {
    this.pool.cancel(episodeId, witchSessionId)
    return true
  }

  /**
   * Run Memory Broker over one transcript and return the capsule, possibly empty.
   * @param messages - current enter-decision messages.
   * @param candidates - retrieved hits, already collected off-model.
   * @param filter - cheap-model filter; may throw.
   */
  async broker(
    messages: readonly Message[],
    candidates: readonly MemoryCandidate[],
    filter: (packed: string) => Promise<string>,
  ): Promise<MemoryCapsule | undefined> {
    const human = latestHumanMessage(messages)
    if (human === undefined) return undefined
    const humanMessageId = human.id ?? 'human'
    const packed = packBrokerInput({
      humanMessageId,
      humanText: textOf(human),
      contract: '',
      candidates,
    }, this.brokerInputTokens)
    let raw = ''
    try {
      raw = await filter(packed.packed)
    } catch {
      raw = ''
    }
    const capsule: MemoryCapsule = {
      humanMessageId,
      text: clipCapsuleText(raw, this.brokerOutputTokens),
      sources: candidates.map(c => c.id).slice(0, 8),
    }
    this.capsules.set(humanMessageId, capsule)
    return capsule
  }

  /**
   * Inject at most one capsule reminder for the latest human message.
   * @param decision - pre-step enter decision.
   */
  private async injectCapsule(decision: { kind: 'enter'; messages: UserMessage[] }): Promise<{ kind: 'enter'; messages: UserMessage[] }> {
    const human = latestHumanMessage(decision.messages)
    if (human === undefined) return decision
    const humanMessageId = human.id ?? 'human'
    if (this.capsules.has(humanMessageId)) return decision
    const capsule = await this.broker(decision.messages, [], async () => '')
    if (capsule === undefined) return decision
    const reminder = createUserMessage({
      content: [{ type: 'text', text: capsuleReminder(capsule) }],
      source: { kind: 'plugin', plugin: 'witches-runtime', form: 'notice', summary: 'Relevant memory found' },
    })
    return { kind: 'enter', messages: [...decision.messages, reminder] }
  }
}

export default WitchesRuntime
