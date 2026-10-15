// Multi-stage expert cycle: cheap collector → expensive planner → cheap
// budgeted workers → expensive reviewer, with a bounded replan loop.
// Canonical typed source:
// dsh-witches-clone/packages/experimental/witches-runtime/src/cycle-runner.ts

import { CYCLE_PHASE, ExecutionCycle, parseStageReply } from './execution-cycle.js'

const COLLECTOR_REPLY = '{"role":"collector","facts":["file path or artifact plus the observed fact"]}'
const PLANNER_REPLY = '{"role":"planner","assignments":[{"id":"w1","goal":"bounded change","scope":"absolute permitted root","accept":["named check"],"allowedTools":["read","edit"],"calls":6}]}'
const WORKER_REPLY = '{"role":"worker","evidence":["changed files and executed checks with results"]}'
const REVIEWER_REPLY = '{"role":"reviewer","accepted":false,"evidence":["observed check results and reasons; do not trust worker claims alone"]}'

const STAGE_PROMPT = Object.freeze({
  collector: 'Inspect the goal with read-only tools. Do not modify anything. Return one JSON object only.',
  planner: 'Plan bounded worker assignments from the collected facts. Tools outside the whitelist are rejected. Return one JSON object only.',
  worker: 'Execute exactly your assignment, stay inside its scope and allowed tools, then report evidence. Return one JSON object only.',
  reviewer: 'Verify the worker evidence yourself with read-only tools, then accept or reject. Return one JSON object only.',
})

/**
 * Runs one witch's project task through the full cycle.
 *
 * Every stage is a one-shot child run whose reply must be the exact stage JSON;
 * a bad reply, a failed child, or an exhausted iteration budget ends the task
 * with a paused cycle. Nothing in this function assumes the caller awaits it —
 * the witch's turn continues while the cycle runs.
 *
 * @param deps.stage - `(spec) => Promise<string>`; returns the child's final text.
 * @param deps.trace - `(record) => void | Promise<void>`; broker trace sink.
 * @param deps.routes - `{ cheap, expensive }` provider/model pairs.
 * @param deps.signal - cancellation for the whole task.
 * @param deps.owner - owning witch session id.
 * @param deps.goal - human task text.
 * @param deps.factsHint - already-known sources (Broker capsule ids).
 * @param deps.maxReviews - bounded expert review iterations.
 * @param deps.cycle - task to run (a fresh `ExecutionCycle` by default).
 * @returns the terminal cycle state and reviewer evidence.
 */
export async function runExpertCycle(deps) {
  const { stage, trace, routes, signal, owner, goal, maxReviews, factsHint = [] } = deps
  const cycle = deps.cycle ?? new ExecutionCycle(owner, goal)
  const max = Number.isSafeInteger(maxReviews) && maxReviews > 0 ? maxReviews : 2
  const record = (data) => { try { void trace(data) } catch { /* trace must not break the cycle */ } }
  record({ kind: 'cycle-start', owner, goal: goal.slice(0, 400), routes, maxReviews: max })

  const runStage = async (role, stageRoute, stagePrompt, extra = {}) => {
    const spec = { role, route: stageRoute, prompt: stagePrompt, signal, owner, ...extra }
    let text
    try {
      text = await stage(spec)
    } catch (error) {
      record({ kind: 'cycle-stage-error', role, message: String(error && error.message ? error.message : error) })
      throw error
    }
    const reply = parseStageReply(text)
    if (reply.role !== role) throw new Error(`stage ${role} returned a ${reply.role} reply`)
    record({ kind: 'cycle-stage', role, route: stageRoute, chars: String(text).length, version: cycle.version })
    return reply
  }

  try {
    if (signal?.aborted) throw new Error('cycle_aborted')
    const collectorPrompt = [
      STAGE_PROMPT.collector, `Expected reply: ${COLLECTOR_REPLY}`,
      `Goal: ${goal.slice(0, 1200)}`,
      factsHint.length ? `Known sources:\n- ${factsHint.join('\n- ')}` : '',
    ].filter(Boolean).join('\n')
    const collected = await runStage('collector', routes.cheap, collectorPrompt)
    cycle.submitFacts({ owner, version: cycle.version, role: 'collector' }, collected.facts)

    for (let review = 0; review < max; review += 1) {
      if (signal?.aborted) throw new Error('cycle_aborted')
      const version = cycle.version
      const plannerPrompt = [
        STAGE_PROMPT.planner, `Expected reply: ${PLANNER_REPLY}`,
        `Goal: ${goal.slice(0, 1200)}`,
        `Collected facts:\n- ${cycle.facts.join('\n- ')}`,
      ].join('\n')
      const plan = await runStage('planner', routes.expensive, plannerPrompt)
      cycle.submitPlan({ owner, version, role: 'planner' }, plan.assignments)

      const results = []
      for (const assignment of plan.assignments) {
        const workerPrompt = [
          STAGE_PROMPT.worker, `Expected reply: ${WORKER_REPLY}`,
          `Assignment: ${JSON.stringify(assignment)}`,
        ].join('\n')
        const done = await runStage('worker', routes.cheap, workerPrompt, { assignment })
        cycle.submitResult({ owner, version, role: 'worker' }, assignment.id, done.evidence)
        results.push({ id: assignment.id, evidence: done.evidence })
      }

      const reviewerPrompt = [
        STAGE_PROMPT.reviewer, `Expected reply: ${REVIEWER_REPLY}`,
        `Goal: ${goal.slice(0, 1200)}`,
        `Worker evidence:\n${JSON.stringify(results).slice(0, 4000)}`,
      ].join('\n')
      const verdict = await runStage('reviewer', routes.expensive, reviewerPrompt)
      cycle.review({ owner, version, role: 'reviewer' }, verdict.accepted, verdict.evidence)
      record({ kind: 'cycle-review', accepted: verdict.accepted, version, evidence: verdict.evidence.slice(0, 800) })
      if (verdict.accepted) return { ...cycle.inspect(), accepted: true, evidence: verdict.evidence, results }
    }
    cycle.pause(owner)
    record({ kind: 'cycle-paused', reason: 'review_budget_exhausted', version: cycle.version })
    return { ...cycle.inspect(), accepted: false, paused: true }
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    if (cycle.phase !== CYCLE_PHASE.COMPLETED && cycle.phase !== CYCLE_PHASE.CANCELLED) {
      try { cycle.cancel(owner) } catch { /* already terminal */ }
    }
    record({ kind: 'cycle-error', message, phase: cycle.phase, version: cycle.version })
    return { ...cycle.inspect(), accepted: false, error: message }
  }
}