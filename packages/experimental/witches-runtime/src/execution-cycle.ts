/** Expert planning and review authority for one versioned execution task. */
export type CyclePhase = 'collecting' | 'planning' | 'executing' | 'reviewing' | 'completed' | 'paused' | 'cancelled'

/** Bounded assignment produced by the planning expert. */
export interface WorkerAssignment {
  id: string
  goal: string
  scope: string
  accept: readonly string[]
  allowedTools: readonly string[]
  calls: number
}

/** Caller presents the version and stage-issued authority on every operation. */
export interface CycleAuthority {
  owner: string
  version: number
  role: 'collector' | 'planner' | 'worker' | 'reviewer'
}

/** Runtime-owned state; no model may create its own worker assignment. */
export class ExecutionCycle {
  private phaseValue: CyclePhase = 'collecting'
  private versionValue = 1
  private resumePhase: CyclePhase | undefined
  private readonly assignments = new Map<string, { assignment: WorkerAssignment; remaining: number; evidence?: readonly string[] }>()
  private factsValue: readonly string[] = []

  /** Creates a task owned by one human-facing session. */
  constructor(readonly owner: string, readonly goal: string) {
    if (!owner || !goal.trim()) throw new Error('Task requires owner and goal')
  }

  /** Returns compact owned task state, not live maps. */
  inspect(): { phase: CyclePhase; version: number; facts: readonly string[]; workers: { id: string; remaining: number; finished: boolean }[] } {
    return { phase: this.phaseValue, version: this.versionValue, facts: [...this.factsValue], workers: [...this.assignments].map(([id, value]) => ({ id, remaining: value.remaining, finished: value.evidence !== undefined })) }
  }

  private check(authority: CycleAuthority, role: CycleAuthority['role'], phase: CyclePhase): void {
    if (authority.owner !== this.owner || authority.version !== this.versionValue) throw new Error('Foreign or stale task authority')
    if (authority.role !== role || this.phaseValue !== phase) throw new Error('Operation not authorized in current stage')
  }

  /** Collector submits cited facts before planning can start. */
  submitFacts(authority: CycleAuthority, facts: readonly string[]): void {
    this.check(authority, 'collector', 'collecting')
    if (!facts.length || facts.some(fact => !fact.trim())) throw new Error('Collection requires evidence references')
    this.factsValue = [...facts]
    this.phaseValue = 'planning'
  }

  /** Planning expert commits complete worker assignments as one transaction. */
  submitPlan(authority: CycleAuthority, assignments: readonly WorkerAssignment[]): void {
    this.check(authority, 'planner', 'planning')
    const ids = new Set<string>()
    if (!assignments.length) throw new Error('Plan requires assignments')
    for (const assignment of assignments) {
      if (!assignment.id || ids.has(assignment.id) || !assignment.goal.trim() || !assignment.scope.trim() || !assignment.accept.length || !assignment.allowedTools.length || !Number.isSafeInteger(assignment.calls) || assignment.calls < 1) throw new Error('Invalid worker assignment')
      ids.add(assignment.id)
    }
    this.assignments.clear()
    for (const assignment of assignments) this.assignments.set(assignment.id, { assignment: { ...assignment, accept: [...assignment.accept], allowedTools: [...assignment.allowedTools] }, remaining: assignment.calls })
    this.phaseValue = 'executing'
  }

  /** Returns an owned copy of an unfinished worker's contract. */
  assignment(authority: CycleAuthority, assignmentId: string): WorkerAssignment {
    this.check(authority, 'worker', 'executing')
    const entry = this.assignments.get(assignmentId)
    if (!entry || entry.evidence !== undefined) throw new Error('Worker assignment is not active')
    return { ...entry.assignment, accept: [...entry.assignment.accept], allowedTools: [...entry.assignment.allowedTools] }
  }

  /** Reserves a tool call before dispatch; denied calls consume no allowance. */
  reserve(authority: CycleAuthority, assignmentId: string, tool: string): void {
    this.check(authority, 'worker', 'executing')
    const entry = this.assignments.get(assignmentId)
    if (!entry || entry.evidence !== undefined || !entry.assignment.allowedTools.includes(tool)) throw new Error('Tool outside active worker assignment')
    if (entry.remaining === 0) throw new Error('Worker call budget exhausted')
    entry.remaining -= 1
  }

  /** All worker results go to review; worker completion cannot accept the task. */
  submitResult(authority: CycleAuthority, assignmentId: string, evidence: readonly string[]): void {
    this.check(authority, 'worker', 'executing')
    const entry = this.assignments.get(assignmentId)
    if (!entry || entry.evidence !== undefined || !evidence.length) throw new Error('Result requires an unfinished assignment and evidence')
    entry.evidence = [...evidence]
    if ([...this.assignments.values()].every(value => value.evidence !== undefined)) this.phaseValue = 'reviewing'
  }

  /** Review accepts with evidence or starts a new version for corrective planning. */
  review(authority: CycleAuthority, accepted: boolean, evidence: readonly string[]): void {
    this.check(authority, 'reviewer', 'reviewing')
    if (!evidence.length) throw new Error('Review requires evidence')
    if (accepted) this.phaseValue = 'completed'
    else {
      this.versionValue += 1
      this.assignments.clear()
      this.factsValue = [...this.factsValue, ...evidence]
      this.phaseValue = 'planning'
    }
  }

  /** Stops new dispatches; the caller must settle already reserved effects. */
  pause(owner: string): void {
    if (owner !== this.owner || ['completed', 'cancelled', 'paused'].includes(this.phaseValue)) throw new Error('Task cannot be paused')
    this.resumePhase = this.phaseValue
    this.phaseValue = 'paused'
    this.versionValue += 1
  }

  /** Resumes at a new authority version; inputs and rights must be revalidated by the executor. */
  resume(owner: string): void {
    if (owner !== this.owner || this.phaseValue !== 'paused' || !this.resumePhase) throw new Error('Task is not paused')
    this.phaseValue = this.resumePhase
    this.resumePhase = undefined
  }

  /** Invalidates all pending authorities without claiming external side effects were undone. */
  cancel(owner: string): void {
    if (owner !== this.owner) throw new Error('Foreign task owner')
    if (this.phaseValue === 'completed') throw new Error('Completed task cannot be cancelled')
    if (this.phaseValue === 'cancelled') return
    this.versionValue += 1
    this.phaseValue = 'cancelled'
  }
}
