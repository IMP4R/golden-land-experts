/**
 * Shared expert pool: passports, domain memory, isolated episodes, budget.
 * A witch may cancel only its own episode. Cheap route is stamped on every job.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/experts
 */

import { randomUUID } from 'node:crypto'
import type { ExpertMode, ExpertPassport } from './types.ts'

/** Episode lifecycle from the HANDOFF runtime. */
export type EpisodeStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'waiting'
  | 'paused'
  | 'failed'
  | 'cancelling'
  | 'cancelled'

/** Parsed or raw work contract. */
export interface TaskContract {
  /** Message type. */
  type: 'task'
  /** Task id. */
  id: string
  /** Goal sentence. */
  goal: string
  /** Expert scope this contract may touch. */
  scope: string
  /** Optional input refs. */
  inputs: readonly string[]
  /** Constraints the expert must not violate. */
  constraints: readonly string[]
  /** Accept checks. */
  accept: readonly string[]
  /** Call budget reserved for this episode. */
  budget: { calls: number; remaining: number }
  /** Conditions that stop local work and escalate. */
  stopIf: readonly string[]
}

/** Compact result / decision returned to the witch. */
export interface ExpertMessage {
  /** Protocol type. */
  type: 'result' | 'decision' | 'blocked'
  /** Task id. */
  task: string
  /** Outcome. */
  status: 'done' | 'blocked' | 'failed'
  /** What changed. */
  delta?: string
  /** Evidence ids. */
  evidence?: readonly string[]
  /** Accept-check summary. */
  checks?: string
  /** Unverified remainder. */
  unknown?: string
  /** Blocker if a decision is required. */
  blocker?: string
  /** Options when blocked. */
  options?: readonly { id: string; text: string }[]
  /** Recommended option. */
  recommend?: string
  /** What the witch must grant. */
  need?: string
}

/** Isolated work episode owned by one witch. */
export interface ExpertEpisode {
  /** Episode id. */
  id: string
  /** Shared expert. */
  expertId: string
  /** Requesting witch session. */
  witchSessionId: string
  /** Operating mode. */
  mode: ExpertMode
  /** Parsed contract. */
  contract: TaskContract
  /** Lifecycle. */
  status: EpisodeStatus
  /** Assignment version; stale writers are refused. */
  version: number
  /** Cheap route stamped at open. */
  route: { provider: string; model: string }
  /** Witch-private notes, never mixed into shared competence. */
  privateNotes: string[]
  /** Latest protocol message. */
  message?: ExpertMessage
  /** Created at. */
  createdAt: string
  /** Updated at. */
  updatedAt: string
}

/** One shared competence record. */
export interface DomainFact {
  /** Stable id. */
  id: string
  /** Fact text. */
  text: string
  /** Verification status. */
  status: 'verified' | 'hypothesis'
}

const CHEAP = { provider: 'cheapvibecode', model: 'glm-5.3-flash' }

/**
 * Look up an expert by id.
 * @param experts - registry.
 * @param id - expert id.
 */
export function expertById(experts: readonly ExpertPassport[], id: string): ExpertPassport | undefined {
  return experts.find(expert => expert.id === id)
}

/**
 * Whether a witch may cancel this episode.
 * @param episode - live episode.
 * @param witchSessionId - requesting witch.
 */
export function canCancelEpisode(episode: Pick<ExpertEpisode, 'witchSessionId'>, witchSessionId: string): boolean {
  return episode.witchSessionId === witchSessionId
}

/**
 * Parse a free-text or YAML-ish contract into structured fields.
 * @param raw - contract text.
 * @param fallbackScope - expert scope when omitted.
 */
export function parseContract(raw: string, fallbackScope: string): TaskContract {
  const text = raw.trim()
  const field = (name: string): string | undefined => {
    const match = text.match(new RegExp(`(?:^|\\n)${name}:\\s*(.+)$`, 'im'))
    return match?.[1]?.trim()
  }
  const list = (name: string): string[] => {
    const block = text.match(new RegExp(`(?:^|\\n)${name}:\\s*\\n((?:\\s*-\\s*.+\\n?)+)`, 'i'))
    if (block?.[1] === undefined) {
      const one = field(name)
      return one === undefined ? [] : [one]
    }
    return block[1].split('\n').map(line => line.replace(/^\s*-\s*/, '').trim()).filter(Boolean)
  }
  const calls = Number(text.match(/calls:\s*(\d+)/i)?.[1] ?? 12)
  return {
    type: 'task',
    id: field('id') ?? `T-${randomUUID().slice(0, 8)}`,
    goal: field('goal') ?? text.slice(0, 240),
    scope: field('scope') ?? fallbackScope,
    inputs: list('inputs'),
    constraints: list('constraints'),
    accept: list('accept'),
    budget: { calls: Math.max(1, calls), remaining: Math.max(1, calls) },
    stopIf: list('stop_if'),
  }
}

/**
 * Shared expert pool. Domain memory is common; episodes are isolated.
 */
export class ExpertPool {
  readonly experts: readonly ExpertPassport[]
  private readonly domain = new Map<string, DomainFact[]>()
  private readonly episodes = new Map<string, ExpertEpisode>()

  constructor(experts: readonly ExpertPassport[], seed?: Record<string, readonly DomainFact[]>) {
    this.experts = experts
    for (const expert of experts) {
      this.domain.set(expert.id, [...(seed?.[expert.id] ?? [])])
    }
  }

  /**
   * Shared competence facts for one expert.
   * @param expertId - expert.
   */
  memoryOf(expertId: string): readonly DomainFact[] {
    return this.domain.get(expertId) ?? []
  }

  /**
   * Add a verified domain fact. Does not copy witch-private notes.
   * @param expertId - expert.
   * @param text - fact.
   */
  remember(expertId: string, text: string): DomainFact {
    if (expertById(this.experts, expertId) === undefined) throw new Error(`unknown expert "${expertId}"`)
    const fact: DomainFact = { id: `mem-${randomUUID().slice(0, 8)}`, text: text.trim(), status: 'verified' }
    const list = this.domain.get(expertId) ?? []
    list.push(fact)
    this.domain.set(expertId, list)
    return fact
  }

  /**
   * Open an isolated episode and run context / consult / execute locally.
   * @param witchSessionId - owner.
   * @param expertId - shared expert.
   * @param mode - operating mode.
   * @param contractText - task contract.
   */
  ask(
    witchSessionId: string,
    expertId: string,
    mode: ExpertMode,
    contractText: string,
  ): ExpertEpisode {
    const expert = expertById(this.experts, expertId)
    if (expert === undefined) throw new Error(`unknown expert "${expertId}"`)
    const now = new Date().toISOString()
    const contract = parseContract(contractText, expert.scope)
    if (contract.scope.length > 0 && !expert.scope.includes(contract.scope) && !contract.scope.includes(expert.scope)) {
      throw new Error(`contract scope "${contract.scope}" is outside expert "${expert.id}"`)
    }
    const episode: ExpertEpisode = {
      id: randomUUID(),
      expertId,
      witchSessionId,
      mode,
      contract,
      status: 'queued',
      version: 1,
      route: { ...CHEAP },
      privateNotes: [],
      createdAt: now,
      updatedAt: now,
    }
    this.episodes.set(episode.id, episode)
    return this.run(episode.id, witchSessionId)
  }

  /**
   * Inspect one episode without an LLM.
   * @param episodeId - episode.
   */
  inspect(episodeId: string): ExpertEpisode | undefined {
    const episode = this.episodes.get(episodeId)
    return episode === undefined ? undefined : cloneEpisode(episode)
  }

  /**
   * List episodes of one expert. Used to prove two witches do not share logs.
   * @param expertId - expert.
   */
  episodesOf(expertId: string): readonly ExpertEpisode[] {
    return [...this.episodes.values()].filter(episode => episode.expertId === expertId).map(cloneEpisode)
  }

  /**
   * Pause an owned running episode.
   * @param episodeId - episode.
   * @param witchSessionId - owner.
   */
  pause(episodeId: string, witchSessionId: string): ExpertEpisode {
    const episode = this.requireOwned(episodeId, witchSessionId)
    if (episode.status !== 'running' && episode.status !== 'queued' && episode.status !== 'waiting') {
      throw new Error(`cannot pause episode in status ${episode.status}`)
    }
    episode.status = 'paused'
    episode.updatedAt = new Date().toISOString()
    return cloneEpisode(episode)
  }

  /**
   * Resume a paused owned episode and continue the local cycle.
   * @param episodeId - episode.
   * @param witchSessionId - owner.
   */
  resume(episodeId: string, witchSessionId: string): ExpertEpisode {
    const episode = this.requireOwned(episodeId, witchSessionId)
    if (episode.status !== 'paused') throw new Error(`cannot resume episode in status ${episode.status}`)
    episode.version += 1
    return this.run(episode.id, witchSessionId)
  }

  /**
   * Cancel an owned episode. Other witches' episodes stay running.
   * @param episodeId - episode.
   * @param witchSessionId - owner.
   */
  cancel(episodeId: string, witchSessionId: string): ExpertEpisode {
    const episode = this.requireOwned(episodeId, witchSessionId)
    episode.status = 'cancelled'
    episode.updatedAt = new Date().toISOString()
    episode.message = {
      type: 'blocked',
      task: episode.contract.id,
      status: 'failed',
      delta: 'Episode cancelled by owning witch.',
    }
    return cloneEpisode(episode)
  }

  private requireOwned(episodeId: string, witchSessionId: string): ExpertEpisode {
    const episode = this.episodes.get(episodeId)
    if (episode === undefined) throw new Error(`missing episode "${episodeId}"`)
    if (!canCancelEpisode(episode, witchSessionId)) {
      throw new Error('a witch may cancel only its own expert episode')
    }
    return episode
  }

  private run(episodeId: string, witchSessionId: string): ExpertEpisode {
    const episode = this.requireOwned(episodeId, witchSessionId)
    if (episode.status === 'cancelled' || episode.status === 'completed') return cloneEpisode(episode)
    episode.status = 'running'
    episode.contract.budget.remaining = Math.max(0, episode.contract.budget.remaining - 1)
    if (episode.contract.budget.remaining < 0) {
      episode.status = 'failed'
      episode.message = {
        type: 'blocked',
        task: episode.contract.id,
        status: 'failed',
        blocker: 'Call budget exhausted.',
        need: 'Increase budget or split the contract.',
      }
      episode.updatedAt = new Date().toISOString()
      return cloneEpisode(episode)
    }
    const stop = episode.contract.stopIf.find(rule =>
      /migrat|production|policy/i.test(`${rule} ${episode.contract.goal}`),
    )
    if (stop !== undefined) {
      episode.status = 'waiting'
      episode.message = {
        type: 'decision',
        task: episode.contract.id,
        status: 'blocked',
        blocker: stop,
        options: [
          { id: 'A', text: 'Escalate to the witch / prime for authorization.' },
          { id: 'B', text: 'Stay inside current scope and report residual risk.' },
        ],
        recommend: 'A',
        need: 'Authorization to leave the expert scope.',
        evidence: this.memoryOf(episode.expertId).slice(0, 3).map(fact => fact.id),
      }
      episode.updatedAt = new Date().toISOString()
      return cloneEpisode(episode)
    }
    const hits = this.relevantFacts(episode.expertId, episode.contract.goal)
    if (episode.mode === 'context') {
      episode.status = 'completed'
      episode.message = {
        type: 'result',
        task: episode.contract.id,
        status: 'done',
        delta: hits.length === 0
          ? 'No stored competence matched this request.'
          : hits.map(fact => fact.text).join(' '),
        evidence: hits.map(fact => fact.id),
        checks: 'context-only; no tools executed',
        ...(hits.length === 0 ? { unknown: 'Domain memory empty for this query.' } : {}),
      }
      episode.updatedAt = new Date().toISOString()
      return cloneEpisode(episode)
    }
    const checks = this.checkAccept(episode.contract, hits)
    const failed = checks.filter(row => row.ok === false)
    episode.status = failed.length === 0 ? 'completed' : 'waiting'
    episode.message = failed.length === 0
      ? {
        type: 'result',
        task: episode.contract.id,
        status: 'done',
        delta: this.deltaFor(episode, hits),
        evidence: hits.map(fact => fact.id),
        checks: checks.map(row => `${row.text}: PASS`).join('; ') || 'no explicit accept tests',
        ...(hits.length === 0 ? { unknown: 'No domain fact backed this iteration.' } : {}),
      }
      : {
        type: 'decision',
        task: episode.contract.id,
        status: 'blocked',
        blocker: failed.map(row => row.text).join('; '),
        options: [
          { id: 'A', text: 'Gather more evidence and retry locally.' },
          { id: 'B', text: 'Escalate the failed accept checks.' },
        ],
        recommend: 'A',
        need: 'Direction after failed accept checks.',
        evidence: hits.map(fact => fact.id),
      }
    episode.updatedAt = new Date().toISOString()
    return cloneEpisode(episode)
  }

  private relevantFacts(expertId: string, goal: string): DomainFact[] {
    const words = new Set(goal.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3))
    return this.memoryOf(expertId).filter((fact) => {
      const body = new Set(fact.text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 3))
      let hit = 0
      for (const word of words) if (body.has(word)) hit += 1
      return words.size === 0 ? true : hit / words.size >= 0.12
    }).slice(0, 8)
  }

  private checkAccept(
    contract: TaskContract,
    hits: readonly DomainFact[],
  ): Array<{ text: string; ok: boolean }> {
    if (contract.accept.length === 0) return []
    const blob = hits.map(fact => fact.text).join(' ').toLowerCase()
    return contract.accept.map((text) => {
      const keys = text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 4)
      const ok = keys.length === 0 || keys.some(word => blob.includes(word))
      return { text, ok }
    })
  }

  private deltaFor(episode: ExpertEpisode, hits: readonly DomainFact[]): string {
    if (episode.mode === 'consult') {
      return hits.length === 0
        ? 'Consultation found no stored method for this goal.'
        : `Consultation: ${hits.map(fact => fact.text).join(' ')}`
    }
    return hits.length === 0
      ? `Executed one cheap iteration on ${episode.contract.goal}. No stored method; residual risk remains.`
      : `Executed one cheap iteration on ${episode.contract.goal}. Applied stored method: ${hits[0]?.text}`
  }
}

function cloneEpisode(episode: ExpertEpisode): ExpertEpisode {
  return {
    ...episode,
    contract: {
      ...episode.contract,
      inputs: [...episode.contract.inputs],
      constraints: [...episode.contract.constraints],
      accept: [...episode.contract.accept],
      stopIf: [...episode.contract.stopIf],
      budget: { ...episode.contract.budget },
    },
    route: { ...episode.route },
    privateNotes: [...episode.privateNotes],
    ...(episode.message === undefined ? {} : { message: { ...episode.message } }),
  }
}
