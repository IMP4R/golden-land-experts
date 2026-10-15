/** Projects popover rendered next to the native sidebar foot. */
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectsResponse } from './data.ts'
import { loadProjects } from './data.ts'
import css from './ProjectsPopover.module.css'

/** Popover props. */
export interface ProjectsPopoverProps {
  /** Whether the sidebar is in its expanded column state. */
  wide: boolean
  /** Close the popover. */
  onClose: () => void
}

/** Render the project → cluster → session tree.
 * @param props - close callback.
 * @returns the projects popover.
 */
export function ProjectsPopover({ wide, onClose }: ProjectsPopoverProps) {
  const root = useRef<HTMLDivElement | null>(null)
  const [data, setData] = useState<ProjectsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    void loadProjects().then((value) => {
      if (alive) setData(value)
    }).catch((reason: unknown) => {
      if (alive) setError(reason instanceof Error ? reason.message : String(reason))
    })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) onClose()
    }
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const unassigned = useMemo(() => data === null
    ? []
    : data.sessions.filter(session => data.assignments[session.id] === undefined), [data])

  return (
    <div ref={root} className={css.root} data-wide={wide || undefined} role="dialog" aria-label="Проекты">
      <div className={css.header}>
        <span>Проекты</span>
        <button type="button" className={css.close} aria-label="Закрыть проекты" onClick={onClose}>×</button>
      </div>
      <div className={css.body}>
        {error !== null && <div className={css.state} data-error>{error}</div>}
        {data === null && error === null && <div className={css.state}>Загрузка…</div>}
        {data !== null && data.projects.length === 0 && <div className={css.state}>Проектов пока нет</div>}
        {data?.projects.map((project) => {
          const clusters = data.clusters.filter(cluster => cluster.projectId === project.id)
          const sessions = Object.entries(data.assignments).filter(([, value]) => value.projectId === project.id)
          return (
            <section className={css.project} key={project.id}>
              <div className={css.projectName}>{project.name}<span>{sessions.length}</span></div>
              {project.description !== undefined && <div className={css.description}>{project.description}</div>}
              {clusters.map((cluster) => {
                const clusterSessions = sessions.filter(([, value]) => value.clusterId === cluster.id)
                return (
                  <div className={css.cluster} key={cluster.id}>
                    <div className={css.clusterName}>{cluster.name}<span>{clusterSessions.length}</span></div>
                    {clusterSessions.map(([sessionId]) => <div className={css.session} key={sessionId}>{sessionId.slice(0, 8)}</div>)}
                  </div>
                )
              })}
              {sessions.filter(([, value]) => value.clusterId === undefined).map(([sessionId]) =>
                <div className={css.session} key={sessionId}>{sessionId.slice(0, 8)}</div>)}
            </section>
          )
        })}
        {data !== null && (
          <section className={css.project}>
            <div className={css.projectName}>Без проекта<span>{unassigned.length}</span></div>
            {unassigned.map(session =>
              <div className={css.session} key={session.id}>{session.id.slice(0, 8)}</div>)}
          </section>
        )}
      </div>
    </div>
  )
}
