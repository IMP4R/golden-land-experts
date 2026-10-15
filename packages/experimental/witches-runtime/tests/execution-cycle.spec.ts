import { describe, expect, it } from 'vitest'
import { ExecutionCycle, type CycleAuthority } from '../src/execution-cycle.ts'

const authority = (role: CycleAuthority['role'], version = 1): CycleAuthority => ({ owner: 'witch', role, version })
const assignment = { id: 'worker', goal: 'repair fixture', scope: 'fixture', accept: ['fixture passes'], allowedTools: ['edit'], calls: 1 }

function planned(): ExecutionCycle {
  const task = new ExecutionCycle('witch', 'repair fixture')
  task.submitFacts(authority('collector'), ['artifact:inspection'])
  task.submitPlan(authority('planner'), [assignment])
  return task
}

describe('ExecutionCycle', () => {
  it('requires facts and an expert plan before reserve', () => {
    const task = new ExecutionCycle('witch', 'repair')
    expect(() => task.reserve(authority('worker'), 'worker', 'edit')).toThrow()
    expect(() => task.submitPlan(authority('planner'), [assignment])).toThrow()
    task.submitFacts(authority('collector'), ['artifact:inspection'])
    expect(() => task.reserve(authority('worker'), 'worker', 'edit')).toThrow()
  })

  it('enforces reserve tool permissions and budget before dispatch', () => {
    const task = planned()
    expect(() => task.reserve(authority('worker'), 'worker', 'bash')).toThrow()
    expect(task.inspect().workers[0]?.remaining).toBe(1)
    task.reserve(authority('worker'), 'worker', 'edit')
    expect(() => task.reserve(authority('worker'), 'worker', 'edit')).toThrow('budget')
  })

  it('requires reviewer acceptance rather than trusting submitResult', () => {
    const task = planned()
    task.submitResult(authority('worker'), 'worker', ['artifact:result'])
    expect(task.inspect().phase).toBe('reviewing')
    expect(() => task.review(authority('worker'), true, ['artifact:review'])).toThrow()
    task.review(authority('reviewer'), true, ['artifact:review'])
    expect(task.inspect().phase).toBe('completed')
  })

  it('rejects stale work after review requests another plan', () => {
    const task = planned()
    task.submitResult(authority('worker'), 'worker', ['artifact:result'])
    task.review(authority('reviewer'), false, ['artifact:failed-check'])
    expect(task.inspect().version).toBe(2)
    expect(() => task.submitPlan(authority('planner'), [assignment])).toThrow('stale')
    task.submitPlan(authority('planner', 2), [assignment])
  })

  it('pause and resume invalidate outstanding authority', () => {
    const task = planned()
    task.pause('witch')
    expect(() => task.reserve(authority('worker'), 'worker', 'edit')).toThrow()
    task.resume('witch')
    expect(() => task.reserve(authority('worker'), 'worker', 'edit')).toThrow('stale')
    task.reserve(authority('worker', 2), 'worker', 'edit')
  })

  it('cancel denies foreign owners and is idempotent for its owner', () => {
    const task = planned()
    expect(() => task.cancel('foreign')).toThrow()
    task.cancel('witch')
    task.cancel('witch')
    expect(() => task.reserve(authority('worker', 2), 'worker', 'edit')).toThrow()
    expect(task.inspect().phase).toBe('cancelled')
  })

  it('submitPlan rejects duplicate IDs before publishing any assignments', () => {
    const task = new ExecutionCycle('witch', 'repair')
    task.submitFacts(authority('collector'), ['artifact:inspection'])
    expect(() => task.submitPlan(authority('planner'), [assignment, assignment])).toThrow()
    expect(task.inspect().phase).toBe('planning')
    expect(task.inspect().workers).toEqual([])
  })
})
