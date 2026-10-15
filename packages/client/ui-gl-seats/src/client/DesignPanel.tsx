/** Golden Land design preview in the native Harness details column. */
import { useCallback, useEffect, useState } from 'react'
import { IconCloseOutline16, IconRefreshOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import { designUrl, loadDesigns } from './data.ts'
import css from './DesignPanel.module.css'

/** Business face supplied by the temporary details registration. */
export interface DesignPanelInjected {
  /** Close the design panel and release the details shadow. */
  closeDesign: () => void
}

/** Full design-panel props. */
export type DesignPanelProps = PropsRuntime<'details'> & InjectFace<DesignPanelInjected>

/** Render the design catalog and preview iframe in the native details track.
 * @param props - injected close action.
 * @returns design details panel.
 */
export function DesignPanel({ closeDesign }: DesignPanelProps) {
  const [files, setFiles] = useState<readonly string[]>([])
  const [selected, setSelected] = useState('mockup.html')
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)

  const load = useCallback(() => {
    setError(null)
    void loadDesigns().then(({ files: next }) => {
      setFiles(next)
      setSelected(current => next.includes(current)
        ? current
        : next.includes('mockup.html') ? 'mockup.html' : next[0] ?? '')
    }).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') closeDesign() }
    document.addEventListener('keydown', onKeyDown)
    return () => { document.removeEventListener('keydown', onKeyDown) }
  }, [closeDesign])

  const src = selected === '' ? undefined : `${designUrl(selected)}?rev=${revision}`
  return (
    <div className={css.root}>
      <header className={css.header}>
        <div className={css.title}>Дизайн</div>
        <div className={css.actions}>
          <button type="button" className={css.iconButton} aria-label="Обновить превью" onClick={() => { setRevision(value => value + 1) }}>
            <IconRefreshOutline16 size={15} />
          </button>
          <button type="button" className={css.iconButton} aria-label="Закрыть дизайн" onClick={closeDesign}>
            <IconCloseOutline16 size={14} />
          </button>
        </div>
      </header>
      <div className={css.toolbar}>
        <select className={css.select} aria-label="Дизайн-макет" value={selected} onChange={(event) => { setSelected(event.target.value) }}>
          {files.map(file => <option key={file} value={file}>{file.replace(/\.html$/, '')}</option>)}
        </select>
        <button type="button" className={css.reloadCatalog} onClick={load}>Список</button>
      </div>
      {error !== null
        ? <div className={css.state} data-error>{error}</div>
        : src === undefined
          ? <div className={css.state}>Нет дизайн-макетов</div>
          : <iframe className={css.preview} title="Превью дизайна" src={src} />}
    </div>
  )
}
