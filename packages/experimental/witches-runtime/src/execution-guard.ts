/** Executor policy for runtime-issued cycle authorities. */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { PreToolDecision } from '@deepseek-ai/dsh-tools'
import { ExecutionCycle, type CycleAuthority } from './execution-cycle.ts'
import { checkWorkerScope } from './worker-scope.ts'

/** Runtime-issued grant; never derived from tool arguments or model text. */
export interface ExecutionGrant {
  cycle: ExecutionCycle
  authority: CycleAuthority
  assignmentId?: string
}

/** Exact named read tools; unknown tools are denied unless a worker contract permits them. */
const READ_TOOLS = new Set(['read', 'read_image', 'glob', 'grep', 'skill', 'history_search', 'history_read', 'history_artifact_read'])

/** Installs a disposer-owned executor hook; the runtime owns the grant resolver. */
export function installExecutionGuard(ctx: Context, resolve: (agent: Agent) => ExecutionGrant | undefined): () => void {
  return ctx.on('tools/pre-execute', async (exec, next): Promise<PreToolDecision> => {
    const prior = await next()
    if (prior.kind !== 'allow') return prior
    if (!exec.agent) return { kind: 'deny', reason: 'Cycle execution requires an authenticated agent' }
    const grant = resolve(exec.agent)
    if (!grant) return { kind: 'deny', reason: 'No runtime-issued execution assignment; submit the task to the expert cycle' }
    const { cycle, authority } = grant
    const state = cycle.inspect()
    if (authority.owner !== cycle.owner || authority.version !== state.version) return { kind: 'deny', reason: 'Foreign or stale execution assignment' }
    const stage = { collector: 'collecting', planner: 'planning', worker: 'executing', reviewer: 'reviewing' } as const
    if (state.phase !== stage[authority.role]) return { kind: 'deny', reason: 'Execution assignment is not active in this stage' }
    if (authority.role !== 'worker') {
      return READ_TOOLS.has(exec.name) ? prior : { kind: 'deny', reason: 'This stage permits inspection only; shell, code execution, mutation and delegation require a worker assignment' }
    }
    if (!grant.assignmentId) return { kind: 'deny', reason: 'Worker assignment ID missing' }
    try {
      const assignment = cycle.assignment(authority, grant.assignmentId)
      await checkWorkerScope(exec.name, exec.arguments, assignment.scope, exec.agent.session.header.cwd)
      cycle.reserve(authority, grant.assignmentId, exec.name)
      return prior
    } catch (error: unknown) {
      return { kind: 'deny', reason: error instanceof Error ? error.message : String(error) }
    }
  })
}
