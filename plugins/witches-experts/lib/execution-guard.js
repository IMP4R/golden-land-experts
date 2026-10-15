// Runtime authority for cycle participants. A worker call is checked against the
// assignment the planner committed and consumes its call budget before dispatch;
// the human-facing witch cannot mutate the project while her own cycle owns the
// task. Canonical typed source:
// dsh-witches-clone/packages/experimental/witches-runtime/src/execution-guard.ts

import { CYCLE_PHASE } from './execution-cycle.js'
import { AGENT_ROLE, resolveAgentRole } from './agent-role.js'

/** Tools the witch loses while her cycle executes; reads stay available. */
export const CYCLE_RESERVED_TOOLS = Object.freeze([
  'write', 'edit', 'bash', 'pwsh', 'run_code', 'subagent', 'subagent_control', 'workflow',
])

/**
 * Decides one `tools/pre-execute` call from runtime-issued state only: model text
 * and tool arguments never select a role or widen a contract.
 *
 * @param ctx - the witches host plugin context.
 * @returns an effect-owned disposer for the waterfall listener.
 */
export function installCycleGuard(ctx, registry) {
  return ctx.on('tools/pre-execute', async (exec, next) => {
    const prior = await next()
    if (prior.kind !== 'allow' || !exec.agent) return prior
    const agent = exec.agent
    const sessionId = String(agent?.session?.id ?? agent?.id ?? '')
    const authority = agent?.options?.cycleAuthority
    const active = registry.get(sessionId)
    if (authority && active) {
      const cycle = active.cycle
      if (authority.cycleId !== active.cycleId || authority.version !== cycle.version) {
        return { kind: 'deny', reason: 'Stale cycle authority; workers cannot act after a replan, pause, or cancellation' }
      }
      if (cycle.phase !== CYCLE_PHASE.EXECUTING) {
        return { kind: 'deny', reason: `Workers act only while the cycle executes (now ${cycle.phase})` }
      }
      if (resolveAgentRole(agent) !== AGENT_ROLE.WORKER) {
        return { kind: 'deny', reason: 'Only the assigned worker may run tools in the executing stage' }
      }
      try {
        cycle.reserve({ owner: active.owner, version: cycle.version, role: 'worker' }, authority.assignmentId, exec.name)
      } catch (error) {
        return { kind: 'deny', reason: String(error && error.message ? error.message : error) }
      }
      return prior
    }
    if (resolveAgentRole(agent) === AGENT_ROLE.WITCH && active && active.cycle.phase === CYCLE_PHASE.EXECUTING) {
      if (CYCLE_RESERVED_TOOLS.includes(exec.name)) {
        return { kind: 'deny', reason: 'This task is inside the expert cycle; its contracted workers perform the changes. Reply with the cycle report instead.' }
      }
    }
    return prior
  })
}