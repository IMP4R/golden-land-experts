// Versioned execution authority for one project task: collect → plan →
// execute → review. Canonical typed source:
// dsh-witches-clone/packages/experimental/witches-runtime/src/execution-cycle.ts
//
// The runtime owns the state; models present authority on every operation and
// cannot create assignments themselves. Worker results never complete a task —
// only the reviewer accepts, and a rejection starts a new version.

/** Task lifecycle phases. */
export const CYCLE_PHASE = Object.freeze({
  COLLECTING: 'collecting', PLANNING: 'planning', EXECUTING: 'executing',
  REVIEWING: 'reviewing', COMPLETED: 'completed', PAUSED: 'paused', CANCELLED: 'cancelled',
})

/** Stage-role → phase the role may act in. */
const STAGE_OF = Object.freeze({
  collector: CYCLE_PHASE.COLLECTING, planner: CYCLE_PHASE.PLANNING,
  worker: CYCLE_PHASE.EXECUTING, reviewer: CYCLE_PHASE.REVIEWING,
})

/** Worker tools the runtime recognizes; anything else is outside a contract. */
export const WORKER_TOOL_WHITELIST = Object.freeze(['read', 'read_image', 'glob', 'grep', 'write', 'edit'])

/** Reply bounds keep one stage's output inside a contract-sized envelope. */
export const REPLY_BOUNDS = Object.freeze({ maxItems: 12, maxChars: 2000, maxAssignments: 3, maxCalls: 6 })

export class ExecutionCycle {
  /**
   * @param owner - owning witch session id.
   * @param goal - human task the cycle executes.
   */
  constructor(owner, goal) {
    if (!owner || !String(goal || '').trim()) throw new Error('Task requires owner and goal')
    this.owner = String(owner)
    this.goal = String(goal)
    this.phase = CYCLE_PHASE.COLLECTING
    this.version = 1
    this.resumePhase = undefined
    this.facts = []
    /** assignment id → { assignment, remaining, evidence } */
    this.assignments = new Map()
  }

  /** Owned snapshot: plain data only, never live maps. */
  inspect() {
    return {
      phase: this.phase, version: this.version, facts: [...this.facts],
      workers: [...this.assignments].map(([id, value]) => ({ id, remaining: value.remaining, finished: value.evidence !== undefined })),
    }
  }

  #check(authority, role) {
    if (!authority || authority.owner !== this.owner || authority.version !== this.version) {
      throw new Error('Foreign or stale task authority')
    }
    if (authority.role !== role || this.phase !== STAGE_OF[role]) {
      throw new Error('Operation not authorized in current stage')
    }
  }

  /** Collector submits cited facts; planning cannot start without evidence. */
  submitFacts(authority, facts) {
    this.#check(authority, 'collector')
    const clean = cleanStrings(facts)
    if (!clean.length) throw new Error('Collection requires evidence references')
    this.facts = clean
    this.phase = CYCLE_PHASE.PLANNING
  }

  /** Planner commits complete assignments as one transaction or not at all. */
  submitPlan(authority, assignments) {
    this.#check(authority, 'planner')
    if (!Array.isArray(assignments) || assignments.length === 0) throw new Error('Plan requires assignments')
    if (assignments.length > REPLY_BOUNDS.maxAssignments) throw new Error('too_many_assignments')
    const seen = new Set()
    const prepared = assignments.map((raw) => {
      const assignment = sanitizeAssignment(raw)
      if (seen.has(assignment.id)) throw new Error('duplicate_assignment_id')
      seen.add(assignment.id)
      return assignment
    })
    this.assignments.clear()
    for (const assignment of prepared) this.assignments.set(assignment.id, { assignment, remaining: assignment.calls })
    this.phase = CYCLE_PHASE.EXECUTING
  }

  /** Owned copy of an active assignment for the executor to read. */
  assignment(authority, assignmentId) {
    this.#check(authority, 'worker')
    const entry = this.assignments.get(String(assignmentId))
    if (!entry || entry.evidence !== undefined) throw new Error('Worker assignment is not active')
    return { ...entry.assignment, accept: [...entry.assignment.accept], allowedTools: [...entry.assignment.allowedTools] }
  }

  /** Reserves one tool call before dispatch; denied calls consume no budget. */
  reserve(authority, assignmentId, tool) {
    this.#check(authority, 'worker')
    const entry = this.assignments.get(String(assignmentId))
    if (!entry || entry.evidence !== undefined || !entry.assignment.allowedTools.includes(String(tool))) {
      throw new Error('Tool outside active worker assignment')
    }
    if (entry.remaining === 0) throw new Error('Worker call budget exhausted')
    entry.remaining -= 1
  }

  /** Worker submits bounded evidence; completion waits for review. */
  submitResult(authority, assignmentId, evidence) {
    this.#check(authority, 'worker')
    const entry = this.assignments.get(String(assignmentId))
    if (!entry || entry.evidence !== undefined) throw new Error('Result requires an unfinished assignment')
    entry.evidence = cleanStrings(evidence)
    if ([...this.assignments.values()].every((value) => value.evidence !== undefined)) this.phase = CYCLE_PHASE.REVIEWING
  }

  /** Reviewer accepts with evidence or opens a new planning version. */
  review(authority, accepted, evidence) {
    this.#check(authority, 'reviewer')
    const clean = cleanStrings(evidence)
    if (!clean.length) throw new Error('Review requires evidence')
    if (accepted) this.phase = CYCLE_PHASE.COMPLETED
    else {
      this.version += 1
      this.assignments.clear()
      this.facts = [...this.facts, ...clean]
      this.phase = CYCLE_PHASE.PLANNING
    }
  }

  /** Stops new dispatches and invalidates outstanding authorities. */
  pause(owner) {
    if (owner !== this.owner || [CYCLE_PHASE.COMPLETED, CYCLE_PHASE.CANCELLED, CYCLE_PHASE.PAUSED].includes(this.phase)) {
      throw new Error('Task cannot be paused')
    }
    this.resumePhase = this.phase
    this.phase = CYCLE_PHASE.PAUSED
    this.version += 1
  }

  resume(owner) {
    if (owner !== this.owner || this.phase !== CYCLE_PHASE.PAUSED || !this.resumePhase) throw new Error('Task is not paused')
    this.phase = this.resumePhase
    this.resumePhase = undefined
  }

  cancel(owner) {
    if (owner !== this.owner) throw new Error('Foreign task owner')
    if (this.phase === CYCLE_PHASE.COMPLETED) throw new Error('Completed task cannot be cancelled')
    if (this.phase === CYCLE_PHASE.CANCELLED) return
    this.version += 1
    this.phase = CYCLE_PHASE.CANCELLED
  }
}

/** Trims, bounds and drops empty strings; overflow items are rejected. */
function cleanStrings(values) {
  if (!Array.isArray(values)) throw new Error('Expected a string list')
  const clean = values.map((value) => String(value ?? '').trim()).filter(Boolean)
  if (!clean.length || clean.length > REPLY_BOUNDS.maxItems) throw new Error('too_many_items')
  if (clean.some((value) => value.length > REPLY_BOUNDS.maxChars)) throw new Error('item_too_large')
  return clean
}

/** Validates one planner assignment; unknown tools make the plan invalid. */
function sanitizeAssignment(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid worker assignment')
  const id = String(raw.id ?? '').trim()
  const goal = String(raw.goal ?? '').trim()
  const scope = String(raw.scope ?? '').trim()
  if (!id || !goal || !scope) throw new Error('Invalid worker assignment')
  const accept = cleanStrings(raw.accept)
  const allowedTools = cleanStrings(raw.allowedTools)
  if (!allowedTools.every((tool) => WORKER_TOOL_WHITELIST.includes(tool))) throw new Error('tool_outside_whitelist')
  const calls = Number(raw.calls)
  if (!Number.isSafeInteger(calls) || calls < 1 || calls > REPLY_BOUNDS.maxCalls) throw new Error('invalid_call_budget')
  return { id, goal, scope, accept, allowedTools, calls }
}

/**
 * Parses one stage reply: a single JSON object naming its role, carrying exactly
 * the fields that role owns. Prose wrappers, markdown fences, unknown fields, and
 * trailing text are failures, so a stage cannot smuggle claims past validation.
 * @param raw - full assistant text of the stage child.
 * @returns the validated stage payload.
 */
export function parseStageReply(raw) {
  let value
  try { value = JSON.parse(String(raw ?? '')) } catch { throw new Error('reply_not_json') }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('reply_not_object')
  const role = value.role
  if (typeof role !== 'string') throw new Error('reply_without_role')
  const keys = Object.keys(value).sort().join(',')
  if (role === 'collector' && keys === 'facts,role') return { role, facts: cleanStrings(value.facts) }
  if (role === 'worker' && keys === 'evidence,role') return { role, evidence: cleanStrings(value.evidence) }
  if (role === 'reviewer' && keys === 'accepted,evidence,role') {
    if (typeof value.accepted !== 'boolean') throw new Error('review_requires_boolean')
    return { role, accepted: value.accepted, evidence: cleanStrings(value.evidence) }
  }
  if (role === 'planner' && keys === 'assignments,role') {
    if (!Array.isArray(value.assignments) || value.assignments.length === 0) throw new Error('plan_requires_assignments')
    return { role, assignments: value.assignments.map(sanitizeAssignment) }
  }
  throw new Error(`unknown_or_missing_fields:${role}`)
}
