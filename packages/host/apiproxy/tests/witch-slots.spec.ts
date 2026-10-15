import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { applyIsolatedSlot, isolatedRoutesSync } from '../src/witch-routes.ts'

describe('executor slot writes', () => {
  let home: string
  beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'witch-slots-'))
    process.env.DSH_HOME = home
    process.env.GOLDEN_LAND_WITCHES_ISOLATED = '1'
  })
  afterEach(async () => { await rm(home, { recursive: true, force: true }) })

  it('writes a named slot without moving the active slot', async () => {
    const before = isolatedRoutesSync('s1')!
    await applyIsolatedSlot('s1', 'expensive', { provider: 'p2', model: 'm2' })
    const after = isolatedRoutesSync('s1')!
    expect(after.expensive).toEqual({ provider: 'p2', model: 'm2' })
    expect(after.cheap).toEqual(before.cheap)
    expect(after.active).toBe(before.active)
    expect(after.revision).toBe(before.revision + 1)
  })

  it('exposes both slots for the panel and stays undefined outside isolation', async () => {
    expect(isolatedRoutesSync('s1')).toMatchObject({ active: expect.any(String) })
    delete process.env.GOLDEN_LAND_WITCHES_ISOLATED
    expect(isolatedRoutesSync('s1')).toBeUndefined()
    expect(await applyIsolatedSlot('s1', 'cheap', { provider: 'p', model: 'm' })).toBeUndefined()
  })
})
