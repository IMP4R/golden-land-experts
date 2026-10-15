/** Native sidebar-foot rows for Golden Land Projects and Design. */
import { useCallback, useState } from 'react'
import {
  IconFolderOpenOutline16, IconPersonalizationOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { GlSeatsState } from './controller.ts'
import { ProjectsPopover } from './ProjectsPopover.tsx'
import css from './GlSeats.module.css'

/** Business face injected into the sidebar occupant. */
export interface GlSeatsInjected {
  hooks: {
    /** Shared active state bound as `useGlSeats`. */
    glSeats: SnapshotStore<GlSeatsState>
  }
  /** Toggle the temporary Design occupant of the details slot. */
  toggleDesign: () => void
}

/** Full sidebar occupant props. */
export type GlSeatsProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<GlSeatsInjected>

/** Render the two Golden Land footer rows.
 * @param props - sidebar width, state hook, and design action.
 * @returns one list-slot occupant containing both rows.
 */
export function GlSeats({ wide, useSessions, useGlSeats, toggleDesign }: GlSeatsProps) {
  const designOpen = useGlSeats(state => state.designOpen)
  const designAvailable = useSessions((list) => {
    const current = list.current
    return current !== undefined && list.byId[current]?.blank === false
  })
  const [projectsOpen, setProjectsOpen] = useState(false)
  const closeProjects = useCallback(() => { setProjectsOpen(false) }, [])

  return (
    <div className={css.root} data-wide={wide || undefined}>
      <button
        type="button"
        className={css.row}
        aria-label="Проекты"
        aria-expanded={projectsOpen}
        data-active={projectsOpen || undefined}
        onClick={() => { setProjectsOpen(value => !value) }}
        onPointerDown={(event) => { event.stopPropagation() }}
      >
        <IconFolderOpenOutline16 size={17} />
        {wide && <span>Проекты</span>}
      </button>
      <button
        type="button"
        className={css.row}
        aria-label={designAvailable ? 'Дизайн' : 'Дизайн доступен в активной сессии'}
        aria-pressed={designOpen}
        data-active={designOpen || undefined}
        disabled={!designAvailable}
        onClick={toggleDesign}
      >
        <IconPersonalizationOutline16 size={17} />
        {wide && <span>Дизайн</span>}
      </button>
      {projectsOpen && <ProjectsPopover wide={wide} onClose={closeProjects} />}
    </div>
  )
}
