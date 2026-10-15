/** Golden Land Projects and Design seats for the native Harness UI. */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import { GlSeatsController } from './controller.ts'
import type { DesignPanelInjected } from './DesignPanel.tsx'
import { DesignPanel } from './DesignPanel.tsx'
import type { GlSeatsInjected } from './GlSeats.tsx'
import { GlSeats } from './GlSeats.tsx'

/** Required services for the footer registration and details panel control. */
export const inject = ['slots', 'layout', 'sessions']

/** Register one sidebar occupant and temporarily shadow the native details panel while Design is open.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  const controller = new GlSeatsController()
  let disposeDesign: (() => Promise<void>) | undefined

  const closeDesign = (): void => {
    const dispose = disposeDesign
    if (dispose === undefined) return
    disposeDesign = undefined
    void dispose()
    ctx.layout.closeDetails()
  }

  const openDesign = (): void => {
    if (disposeDesign !== undefined) return
    disposeDesign = ctx.effect(() => {
      const dispose = ctx.slots.register({
        name: 'details',
        priority: -10,
        inject: (): DesignPanelInjected => ({ closeDesign }),
      }, DesignPanel)
      controller.setDesignOpen(true)
      return () => {
        dispose()
        controller.setDesignOpen(false)
      }
    }, 'ui-gl-seats: design details shadow')
    ctx.layout.openDetails()
  }

  const toggleDesign = (): void => {
    if (disposeDesign === undefined) openDesign()
    else closeDesign()
  }

  const seatInjected = (): GlSeatsInjected => ({
    hooks: { glSeats: controller.store },
    toggleDesign,
  })

  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'golden-land',
    order: 40,
    label: 'Golden Land',
    inject: seatInjected,
  }, GlSeats))

  let currentSession = ctx.sessions.list.getSnapshot().current
  ctx.effect(() => ctx.sessions.list.subscribe(() => {
    const nextSession = ctx.sessions.list.getSnapshot().current
    if (nextSession === currentSession) return
    currentSession = nextSession
    if (disposeDesign !== undefined) closeDesign()
  }), 'ui-gl-seats: close design on session change')

  ctx.effect(() => () => { closeDesign() }, 'ui-gl-seats: design teardown')
}
