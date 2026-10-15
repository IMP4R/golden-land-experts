/** Validates untrusted stage replies before the runner changes task state. */
import type { StageResult } from './cycle-runner.ts'
import type { WorkerAssignment } from './execution-cycle.ts'

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Stage reply must be an object')
  return value as Record<string, unknown>
}
function strings(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.some(item => typeof item !== 'string' || !item.trim())) throw new Error('Expected nonempty string list')
  return value as string[]
}
function text(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error('Expected nonempty string')
  return value
}

/** Parses one complete JSON reply; markdown wrappers and trailing text are errors. */
export function parseStageResult(raw: string): StageResult {
  const value = object(JSON.parse(raw) as unknown)
  switch (value.role) {
    case 'collector': return { role: 'collector', facts: strings(value.facts) }
    case 'worker': return { role: 'worker', evidence: strings(value.evidence) }
    case 'reviewer': {
      if (typeof value.accepted !== 'boolean') throw new Error('Review requires boolean accepted')
      return { role: 'reviewer', accepted: value.accepted, evidence: strings(value.evidence) }
    }
    case 'planner': {
      if (!Array.isArray(value.assignments) || !value.assignments.length) throw new Error('Plan requires assignments')
      const assignments: WorkerAssignment[] = value.assignments.map(rawAssignment => {
        const item = object(rawAssignment)
        if (typeof item.calls !== 'number' || !Number.isSafeInteger(item.calls) || item.calls < 1) throw new Error('Invalid calls budget')
        return { id: text(item.id), goal: text(item.goal), scope: text(item.scope), accept: strings(item.accept), allowedTools: strings(item.allowedTools), calls: item.calls }
      })
      return { role: 'planner', assignments }
    }
    default: throw new Error('Unknown stage role')
  }
}
