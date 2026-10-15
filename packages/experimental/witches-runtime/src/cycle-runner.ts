/** Drives expert/worker stages with fixed routes and executor-issued grants. */
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ExecutionCycle, type CycleAuthority, type WorkerAssignment } from './execution-cycle.ts'
import type { ExecutionGrant } from './execution-guard.ts'
import type { WitchRoute } from './types.ts'

/** Provider-owned stage result. Model output is validated before state changes. */
export type StageResult =
  | { role: 'collector'; facts: string[] }
  | { role: 'planner'; assignments: WorkerAssignment[] }
  | { role: 'worker'; evidence: string[] }
  | { role: 'reviewer'; accepted: boolean; evidence: string[] }

/** Provider receives a stage request and binds the actual Agent before execution. */
export interface StageRequest {
  role: CycleAuthority['role']
  route: WitchRoute
  goal: string
  version: number
  facts: readonly string[]
  assignment?: WorkerAssignment
  results: readonly { id: string; evidence: readonly string[] }[]
  signal: AbortSignal
  bind(agent: Agent): void
}

/** Every provider adapter must validate its external result before returning it. */
export interface CycleProvider {
  run(request: StageRequest): Promise<StageResult>
}

/** Runtime-owned runner; models never receive a role-authority mutation API. */
export class CycleRunner {
  private readonly grants = new WeakMap<Agent, ExecutionGrant>()

  /** Resolves only currently bound Agents for the tools/pre-execute hook. */
  grant(agent: Agent): ExecutionGrant | undefined { return this.grants.get(agent) }

  /** Runs bounded iterations; a failed review returns to planning, not to the human dialogue. */
  async run(cycle: ExecutionCycle, routes: { cheap: WitchRoute; expensive: WitchRoute }, provider: CycleProvider, signal: AbortSignal, maxReviews: number): Promise<void> {
    if (!Number.isSafeInteger(maxReviews) || maxReviews < 1) throw new Error('maxReviews must be positive')
    const pinned = { cheap: { ...routes.cheap }, expensive: { ...routes.expensive } }
    let results: { id: string; evidence: readonly string[] }[] = []
    const stage = async (role: CycleAuthority['role'], assignment?: WorkerAssignment): Promise<StageResult> => {
      signal.throwIfAborted()
      const state = cycle.inspect()
      const authority: CycleAuthority = { owner: cycle.owner, version: state.version, role }
      const agents: Agent[] = []
      let active = true
      try {
        const result = await provider.run({
          role, route: { ...pinned[role === 'planner' || role === 'reviewer' ? 'expensive' : 'cheap'] },
          goal: cycle.goal, version: state.version, facts: state.facts,
          ...(assignment ? { assignment } : {}), results: results.map(value => ({ id: value.id, evidence: [...value.evidence] })), signal,
          bind: agent => {
            signal.throwIfAborted()
            if (!active) throw new Error('Stage is already settled')
            if (this.grants.has(agent)) throw new Error('Agent already owns a stage grant')
            this.grants.set(agent, { cycle, authority, ...(assignment ? { assignmentId: assignment.id } : {}) })
            agents.push(agent)
          },
        })
        signal.throwIfAborted()
        if (result.role !== role) throw new Error('Provider returned another stage result')
        if (cycle.inspect().version !== state.version) throw new Error('Stage result is stale')
        return result
      } finally {
        active = false
        for (const agent of agents) this.grants.delete(agent)
      }
    }
    const collected = await stage('collector')
    if (collected.role !== 'collector') throw new Error('Expected collection')
    cycle.submitFacts({ owner: cycle.owner, role: 'collector', version: cycle.inspect().version }, collected.facts)
    for (let review = 0; review < maxReviews; review += 1) {
      const plan = await stage('planner')
      if (plan.role !== 'planner') throw new Error('Expected planning')
      const version = cycle.inspect().version
      cycle.submitPlan({ owner: cycle.owner, role: 'planner', version }, plan.assignments)
      results = []
      for (const assignment of plan.assignments) {
        const result = await stage('worker', assignment)
        if (result.role !== 'worker') throw new Error('Expected worker result')
        cycle.submitResult({ owner: cycle.owner, role: 'worker', version }, assignment.id, result.evidence)
        results.push({ id: assignment.id, evidence: [...result.evidence] })
      }
      const result = await stage('reviewer')
      if (result.role !== 'reviewer') throw new Error('Expected review')
      cycle.review({ owner: cycle.owner, role: 'reviewer', version }, result.accepted, result.evidence)
      if (result.accepted) return
    }
    cycle.pause(cycle.owner)
    throw new Error('Expert review iteration budget exhausted; task paused')
  }
}
