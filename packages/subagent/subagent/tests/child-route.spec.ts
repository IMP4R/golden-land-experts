import { describe, expect, it } from 'vitest'
import { bindLiveModelSelection, type Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import { resolveChildAgentOptions } from '../src/child-agent.ts'

function parentWithOptions(): Agent {
  return {
    id: SessionId('parent'),
    options: {},
  } as unknown as Agent
}

describe('resolveChildAgentOptions()', () => {
  it('uses cheap by default in the isolated witches profile even if the parent is expensive', () => {
    const previous = process.env.GOLDEN_LAND_WITCHES_ISOLATED
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
    try {
      const parent = parentWithOptions()
      bindLiveModelSelection(parent, {
        current: { provider: 'cheapvibecode', model: 'gpt-6-astra' },
        assembled: undefined,
      })
      const resolved = resolveChildAgentOptions(parent, undefined, 1)
      expect(resolved.provider).toBe('cheapvibecode')
      expect(resolved.model).toBe('deepseek-v4.1-flash')
    } finally {
      if (previous === undefined) delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
      else process.env.GOLDEN_LAND_WITCHES_ISOLATED = previous
    }
  })

  it('inherits the live picker only when inheritParentRoute is explicit', () => {
    const previous = process.env.GOLDEN_LAND_WITCHES_ISOLATED
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
    try {
      const parent = parentWithOptions()
      bindLiveModelSelection(parent, {
        current: { provider: 'cheapvibecode', model: 'gpt-6-astra' },
        assembled: undefined,
      })
      const resolved = resolveChildAgentOptions(parent, { inheritParentRoute: true }, 1)
      expect(resolved.model).toBe('gpt-6-astra')
      expect(resolved.inheritParentRoute).toBeUndefined()
    } finally {
      if (previous === undefined) delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
      else process.env.GOLDEN_LAND_WITCHES_ISOLATED = previous
    }
  })

  it('inherits the live picker route outside isolation when parent.options is empty', () => {
    const previous = process.env.GOLDEN_LAND_WITCHES_ISOLATED
    delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
    try {
      const parent = parentWithOptions()
      bindLiveModelSelection(parent, {
        current: { provider: 'cheapvibecode', model: 'grok-4.6' },
        assembled: undefined,
      })
      const resolved = resolveChildAgentOptions(parent, undefined, 1)
      expect(resolved.provider).toBe('cheapvibecode')
      expect(resolved.model).toBe('grok-4.6')
      expect(resolved.subagentDepth).toBe(1)
    } finally {
      if (previous === undefined) delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
      else process.env.GOLDEN_LAND_WITCHES_ISOLATED = previous
    }
  })

  it('reads the cheap slot from witch-routes.json when isolated', () => {
    const previous = process.env.GOLDEN_LAND_WITCHES_ISOLATED
    const previousHome = process.env.DSH_HOME
    const dir = '/tmp/dsh-witch-routes-test'
    const { mkdirSync, writeFileSync, rmSync } = require('node:fs') as typeof import('node:fs')
    mkdirSync(`${dir}/storages`, { recursive: true })
    writeFileSync(`${dir}/storages/witch-routes.json`, JSON.stringify({
      'session-slot-test': {
        cheap: { provider: 'cheapvibecode', model: 'glm-5.3-flash' },
        expensive: { provider: 'cheapvibecode', model: 'gpt-6-astra' },
        active: 'expensive',
      },
    }))
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
    process.env.DSH_HOME = dir
    try {
      const parent = parentWithOptions()
      ;(parent as { session?: { id: string } }).session = { id: 'session-slot-test' }
      bindLiveModelSelection(parent, {
        current: { provider: 'cheapvibecode', model: 'gpt-6-astra' },
        assembled: undefined,
      })
      const resolved = resolveChildAgentOptions(parent, undefined, 1)
      expect(resolved.model).toBe('glm-5.3-flash')
    } finally {
      rmSync(dir, { recursive: true, force: true })
      if (previous === undefined) delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
      else process.env.GOLDEN_LAND_WITCHES_ISOLATED = previous
      if (previousHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousHome
    }
  })

  it('lets an explicit child override win over the live picker', () => {
    const parent = parentWithOptions()
    bindLiveModelSelection(parent, {
      current: { provider: 'cheapvibecode', model: 'grok-4.6' },
      assembled: undefined,
    })
    const resolved = resolveChildAgentOptions(parent, {
      provider: 'cheapvibecode',
      model: 'deepseek-v4.1-flash',
    }, 2)
    expect(resolved.model).toBe('deepseek-v4.1-flash')
    expect(resolved.subagentDepth).toBe(2)
  })
})
