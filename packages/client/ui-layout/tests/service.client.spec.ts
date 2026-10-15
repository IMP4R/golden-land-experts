/**
 * LayoutController behavior: the cross-plugin panel-action face. Geometry
 * lives in the entry store (layout-store.spec.ts) — here we assert the
 * delegation contract: attachPanels wiring, action forwarding, deferred
 * details intent, sidebar fail-loud, and re-attach overwriting stale actions.
 */
import { describe, expect, it, vi } from 'vitest'
import { LayoutController } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'
import type { PanelActions } from '@deepseek-ai/dsh-client-ui-layout/src/client/service.ts'

function fakePanels(): PanelActions {
  return {
    setSidebar: vi.fn(),
    setDetails: vi.fn(),
    toggleSidebar: vi.fn(),
    setNarrow: vi.fn(),
    openDetails: vi.fn(),
    closeDetails: vi.fn(),
  }
}

describe('LayoutController', () => {
  it('forwards the three panel actions to the attached set', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.attachPanels(panels)

    service.toggleSidebar()
    service.openDetails()
    service.closeDetails()

    expect(panels.toggleSidebar).toHaveBeenCalledTimes(1)
    expect(panels.openDetails).toHaveBeenCalledTimes(1)
    expect(panels.closeDetails).toHaveBeenCalledTimes(1)
    expect(panels.setSidebar).not.toHaveBeenCalled()
    expect(panels.setDetails).not.toHaveBeenCalled()
  })

  it('defers details intent until the root entry wires its actions', () => {
    const service = new LayoutController()
    const opened = fakePanels()
    service.openDetails()
    service.attachPanels(opened)
    expect(opened.openDetails).toHaveBeenCalledOnce()
    expect(opened.closeDetails).not.toHaveBeenCalled()

    const closed = fakePanels()
    service.closeDetails()
    service.attachPanels(closed)
    expect(closed.closeDetails).toHaveBeenCalledOnce()
    expect(closed.openDetails).not.toHaveBeenCalled()
    expect(() => { new LayoutController().toggleSidebar() }).toThrow(/panel actions not wired/)
  })

  it('re-attach overwrites the stale action set (entry re-register)', () => {
    const service = new LayoutController()
    const stale = fakePanels()
    const fresh = fakePanels()
    service.attachPanels(stale)
    service.attachPanels(fresh)

    service.toggleSidebar()

    expect(stale.toggleSidebar).not.toHaveBeenCalled()
    expect(fresh.toggleSidebar).toHaveBeenCalledTimes(1)
  })

  it('keeps the latest deferred details intent before first attachment', () => {
    const service = new LayoutController()
    const panels = fakePanels()
    service.openDetails()
    service.closeDetails()
    service.openDetails()
    service.attachPanels(panels)

    expect(panels.openDetails).toHaveBeenCalledOnce()
    expect(panels.closeDetails).not.toHaveBeenCalled()
  })
})
