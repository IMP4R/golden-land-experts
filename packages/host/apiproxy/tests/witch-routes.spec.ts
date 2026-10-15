import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  applyIsolatedPicker, isolatedAssembledRoute, isolatedAssembledRouteSync, isolatedDialogueRouteSync, switchIsolatedKind,
} from '../src/witch-routes.ts'

const homes: string[] = []
afterEach(async () => {
  delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
  delete process.env.DSH_HOME
  for (const home of homes.splice(0)) await rm(home, { recursive: true, force: true })
})

describe('isolated dual-route store', () => {
  it('keeps dialogue cheap while configuring the expensive executor slot', async () => {
    const home = await mkdtemp(join(tmpdir(), 'witch-dialogue-'))
    homes.push(home)
    process.env.DSH_HOME = home
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
    const cheap = { provider: 'worker-provider', model: 'worker-model' }
    const expensive = { provider: 'planner-provider', model: 'planner-model' }
    await applyIsolatedPicker('dialogue', cheap)
    await switchIsolatedKind('dialogue', 'expensive')
    await applyIsolatedPicker('dialogue', expensive)
    expect(isolatedAssembledRouteSync('dialogue')).toEqual(expensive)
    expect(isolatedDialogueRouteSync('dialogue')).toEqual(cheap)
    await switchIsolatedKind('dialogue', 'cheap')
    expect(isolatedDialogueRouteSync('dialogue')).toEqual(cheap)
  })

  it('is a no-op without isolation', async () => {
    expect(await applyIsolatedPicker('s1', { provider: 'x', model: 'y' })).toBeUndefined()
  })

  it('writes the picker onto the active slot and switches assembly', async () => {
    const home = await mkdtemp(join(tmpdir(), 'witch-routes-'))
    homes.push(home)
    process.env.DSH_HOME = home
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
    expect(await applyIsolatedPicker('s1', { provider: 'cheapvibecode', model: 'grok-4.6' }))
      .toMatchObject({ revision: 1 })
    expect(await isolatedAssembledRoute('s1')).toEqual({ provider: 'cheapvibecode', model: 'grok-4.6' })
    expect(await switchIsolatedKind('s1', 'expensive')).toMatchObject({ revision: 2 })
    expect(await isolatedAssembledRoute('s1')).toEqual({ provider: 'cheapvibecode', model: 'gpt-6-astra' })
    await applyIsolatedPicker('s1', { provider: 'cheapvibecode', model: 'gpt-6-astra' })
    await switchIsolatedKind('s1', 'cheap')
    expect(await isolatedAssembledRoute('s1')).toEqual({ provider: 'cheapvibecode', model: 'grok-4.6' })
    expect(isolatedAssembledRouteSync('s1')).toEqual({ provider: 'cheapvibecode', model: 'grok-4.6' })
    await switchIsolatedKind('s1', 'expensive')
    expect(isolatedAssembledRouteSync('s1')).toEqual({ provider: 'cheapvibecode', model: 'gpt-6-astra' })
  })

  it('keeps two independent slots from defaults', async () => {
    const home = await mkdtemp(join(tmpdir(), 'witch-routes-'))
    homes.push(home)
    process.env.DSH_HOME = home
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
    expect(isolatedAssembledRouteSync('fresh')).toEqual({
      provider: 'cheapvibecode', model: 'glm-5.3-flash',
    })
    await switchIsolatedKind('fresh', 'expensive')
    expect(isolatedAssembledRouteSync('fresh')).toEqual({
      provider: 'cheapvibecode', model: 'gpt-6-astra',
    })
  })
})
