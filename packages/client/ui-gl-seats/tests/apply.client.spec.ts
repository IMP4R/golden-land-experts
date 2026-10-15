/** Golden Land slot registration, details shadowing, and teardown. */
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { SlotRegistry, createSnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import { apply, inject } from '@deepseek-ai/dsh-client-ui-gl-seats/client'
import type { GlSeatsInjected } from '../src/client/GlSeats.tsx'

async function bench() {
  const ctx = new Context()
  await ctx.plugin(SlotRegistry).await()
  const slots = ctx.get('slots') as SlotRegistry
  slots.register({
    name: 'root',
    children: {
      'sidebar.footer.action': { kind: 'list', scope: 'root' },
      'details': { kind: 'single', scope: 'session' },
    },
  } as never, () => null)
  const nativeDetails = () => null
  slots.register({ name: 'details' } as never, nativeDetails)
  const list = createSnapshotStore({ current: 'session-1', byId: { 'session-1': { blank: false } } })
  const layout = { openDetails: vi.fn(), closeDetails: vi.fn(), toggleSidebar: vi.fn() }
  ctx.provide('layout', layout)
  ctx.provide('sessions', { list } as never)
  const fiber = ctx.plugin({ inject: [...inject], apply })
  await fiber.await()
  return { fiber, slots, layout }
}

describe('ui-gl-seats apply', () => {
  it('declares only the services it uses', () => {
    expect(inject).toEqual(['slots', 'layout', 'sessions'])
  })

  it('temporarily shadows native details and restores it', async () => {
    const b = await bench()
    const seat = b.slots.entries('sidebar.footer.action')[0]
    expect(seat?.options.id).toBe('golden-land')
    const injected = (seat?.inject as () => GlSeatsInjected)()
    expect(injected.hooks.glSeats.getSnapshot()).toEqual({ designOpen: false })

    injected.toggleDesign()
    expect(b.layout.openDetails).toHaveBeenCalledOnce()
    expect(injected.hooks.glSeats.getSnapshot()).toEqual({ designOpen: true })
    expect(b.slots.entries('details')[0]?.options.priority).toBe(-10)

    injected.toggleDesign()
    expect(b.layout.closeDetails).toHaveBeenCalledOnce()
    expect(injected.hooks.glSeats.getSnapshot()).toEqual({ designOpen: false })
    expect(b.slots.entries('details')[0]?.options.priority ?? 0).toBe(0)

    await b.fiber.dispose()
    expect(b.slots.entries('sidebar.footer.action')).toHaveLength(0)
  })
})
