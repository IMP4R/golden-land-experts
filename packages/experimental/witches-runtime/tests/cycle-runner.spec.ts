import { describe, expect, it } from 'vitest'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ExecutionCycle } from '../src/execution-cycle.ts'
import { CycleRunner, type CycleProvider, type StageRequest } from '../src/cycle-runner.ts'

const routes = { cheap: { provider: 'cheap', model: 'worker' }, expensive: { provider: 'expensive', model: 'expert' } }
const assignment = { id: 'w', goal: 'repair', scope: 'fixture', accept: ['test'], allowedTools: ['edit'], calls: 2 }

function provider(trace: StageRequest[], accepts = true): CycleProvider {
  return { async run(request) {
    trace.push(request)
    switch (request.role) {
      case 'collector': return { role: 'collector', facts: ['artifact:inspection'] }
      case 'planner': return { role: 'planner', assignments: [assignment] }
      case 'worker': return { role: 'worker', evidence: ['artifact:test'] }
      case 'reviewer': return { role: 'reviewer', accepted: accepts, evidence: ['artifact:review'] }
    }
  } }
}

describe('CycleRunner', () => {
  it('routes collection/work cheap and planning/review expensive in order', async () => {
    const trace: StageRequest[] = []
    const cycle = new ExecutionCycle('witch', 'repair')
    await new CycleRunner().run(cycle, routes, provider(trace), new AbortController().signal, 2)
    expect(trace.map(r => r.role)).toEqual(['collector', 'planner', 'worker', 'reviewer'])
    expect(trace.map(r => r.route.provider)).toEqual(['cheap', 'expensive', 'cheap', 'expensive'])
    expect(trace[3]?.results).toEqual([{ id: 'w', evidence: ['artifact:test'] }])
    expect(cycle.inspect().phase).toBe('completed')
  })

  it('replans after rejection and pauses when the review budget ends', async () => {
    const trace: StageRequest[] = []
    const cycle = new ExecutionCycle('witch', 'repair')
    await expect(new CycleRunner().run(cycle, routes, provider(trace, false), new AbortController().signal, 2)).rejects.toThrow('budget exhausted')
    expect(trace.map(r => r.role)).toEqual(['collector', 'planner', 'worker', 'reviewer', 'planner', 'worker', 'reviewer'])
    expect(cycle.inspect().phase).toBe('paused')
  })

  it('revokes grants on failure and rejects retained bind callbacks', async () => {
    const runner = new CycleRunner()
    const agent = {} as Agent
    let bind: ((agent: Agent) => void) | undefined
    await expect(runner.run(new ExecutionCycle('witch', 'repair'), routes, { async run(request) {
      bind = request.bind
      request.bind(agent)
      expect(runner.grant(agent)?.authority.role).toBe('collector')
      throw new Error('provider failed')
    } }, new AbortController().signal, 1)).rejects.toThrow('provider failed')
    expect(runner.grant(agent)).toBeUndefined()
    expect(() => bind?.(agent)).toThrow('settled')
  })

  it('discards a stage reply after cancellation', async () => {
    const cycle = new ExecutionCycle('witch', 'repair')
    await expect(new CycleRunner().run(cycle, routes, { async run() {
      cycle.cancel('witch')
      return { role: 'collector', facts: ['artifact:late'] }
    } }, new AbortController().signal, 1)).rejects.toThrow('stale')
    expect(cycle.inspect().facts).toEqual([])
  })
})
