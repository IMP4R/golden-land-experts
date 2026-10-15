import { describe, expect, it } from 'vitest'
import { parseStageResult } from '../src/stage-result.ts'

describe('parseStageResult', () => {
  it('parses collector and worker evidence', () => {
    expect(parseStageResult('{"role":"collector","facts":["file:1"]}')).toEqual({ role: 'collector', facts: ['file:1'] })
    expect(parseStageResult('{"role":"worker","evidence":["test:passed"]}').role).toBe('worker')
  })
  it('requires boolean review decisions and nonempty evidence', () => {
    expect(() => parseStageResult('{"role":"reviewer","accepted":"yes","evidence":["test"]}')).toThrow()
    expect(() => parseStageResult('{"role":"reviewer","accepted":true,"evidence":[]}')).toThrow()
    expect(parseStageResult('{"role":"reviewer","accepted":false,"evidence":["failure"]}')).toEqual({ role: 'reviewer', accepted: false, evidence: ['failure'] })
  })
  it('rejects malformed plans, unknown stages and prose wrappers', () => {
    for (const raw of ['{"role":"planner","assignments":[]}', '{"role":"admin"}', '```json\n{}\n```', '{} extra', '{"role":"worker","evidence":[null]}']) expect(() => parseStageResult(raw)).toThrow()
  })
  it('validates complete worker assignment fields', () => {
    const plan = { role: 'planner', assignments: [{ id: 'w', goal: 'fix', scope: '/fixture', accept: ['test'], allowedTools: ['edit'], calls: 2 }] }
    expect(parseStageResult(JSON.stringify(plan))).toEqual(plan)
    plan.assignments[0]!.calls = -1
    expect(() => parseStageResult(JSON.stringify(plan))).toThrow('budget')
  })
})
