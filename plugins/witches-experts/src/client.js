// Client half of witches-experts: executor-route panel in the composer.
//
// Dialogue always runs on the cheap slot, so the panel never pretends to switch
// the conversation model: it shows both executor slots with the models that run
// the collector/workers and the planner/reviewer, and every change is a silent
// route write with no session event.
import * as React from 'react'

const CSS =
  '.wx-routes{position:relative}' +
  '.wx-routes-trigger{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:24px;border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9aa3b2);font:500 12px/20px inherit;cursor:pointer;white-space:nowrap}' +
  '.wx-routes-trigger:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8ecf2)}' +
  '.wx-routes-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#6b7280)}' +
  '.wx-routes-dot[data-slot="cheap"]{background:#5aa9e6}' +
  '.wx-routes-dot[data-slot="expensive"]{background:#c99bf0}' +
  '.wx-routes-panel{position:absolute;bottom:38px;right:0;z-index:40;width:320px;padding:10px;border-radius:12px;border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,.14));background:var(--dsw-alias-surface-raised,#1b1d22);box-shadow:0 14px 36px rgba(0,0,0,.45)}' +
  '.wx-routes-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;font:600 12px/16px inherit;color:var(--dsw-alias-label-primary,#e8ecf2);white-space:nowrap}' +
  '.wx-routes-head span{margin-left:auto;padding:2px 6px;border-radius:10px;background:var(--dsw-alias-surface-sunken, rgba(255,255,255,.05));font:500 10px/14px inherit;color:var(--dsw-alias-label-secondary,#9aa3b2)}' +
  '.wx-routes-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}' +
  '.wx-routes-row:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.05))}' +
  '.wx-routes-role{display:flex;flex-direction:column;min-width:0;flex:1}' +
  '.wx-routes-name{font:500 12px/15px inherit;color:var(--dsw-alias-label-primary,#e8ecf2)}' +
  '.wx-routes-sub{font:400 10px/13px inherit;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
  '.wx-routes-model{flex:none;max-width:132px;padding:3px 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3b2);font:500 12px/15px inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
  '.wx-routes-model:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8ecf2)}' +
  '.wx-routes-caret{font:400 10px/12px inherit;color:var(--dsw-alias-label-tertiary,#6b7280);flex:none}' +
  '.wx-routes-pick{position:absolute;left:10px;right:10px;bottom:10px;z-index:2;max-height:216px;overflow:auto;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,.16));background:var(--dsw-alias-surface-raised,#1b1d22);box-shadow:0 -10px 28px rgba(0,0,0,.45)}' +
  '.wx-routes-option{display:block;width:100%;text-align:left;padding:6px 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e8ecf2);font:400 12px/15px inherit;cursor:pointer}' +
  '.wx-routes-option:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))}' +
  '.wx-routes-option small{display:block;color:var(--dsw-alias-label-tertiary,#6b7280)}' +
  '.wx-routes-foot{margin-top:8px;font:400 10px/14px inherit;color:var(--dsw-alias-label-tertiary,#6b7280)}'

const SLOT_COPY = { cheap: 'Дешёвая', expensive: 'Дорогая' }
const SLOT_ROLE = {
  cheap: 'воркеры',
  expensive: 'план и проверка',
}

/** Route pair and active-slot view of the two executor slots. */
function RoutesPanel(props) {
  const [open, setOpen] = React.useState(false)
  const [picking, setPicking] = React.useState(null)
  const root = React.useRef(null)
  React.useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [open])

  const routes = props.routes
  const models = props.models || []
  React.useEffect(() => {
    if (open && typeof props.onOpen === 'function') props.onOpen()
  }, [open])
  const choose = async (provider, model) => {
    const kind = picking
    setPicking(null)
    await props.onSelectSlot(kind, { provider, model })
  }
  const triggerLabel = routes ? routes[routes.active].model : 'Маршруты'

  return React.createElement('div', { className: 'wx-routes', ref: root },
    React.createElement('button', {
      type: 'button',
      className: 'wx-routes-trigger',
      'aria-haspopup': 'dialog',
      'aria-expanded': open,
      title: 'Маршруты исполнителей: сборщик и воркеры, планировщик и проверка',
      onClick: () => setOpen((value) => !value),
    },
    React.createElement('span', { className: 'wx-routes-dot', 'data-slot': routes ? routes.active : '' }),
    React.createElement('span', null, 'Исполнители · '), triggerLabel),
    open && React.createElement('div', { className: 'wx-routes-panel', role: 'dialog', 'aria-label': 'Маршруты исполнителей' },
      React.createElement('div', { className: 'wx-routes-head' }, 'Маршруты',
        React.createElement('span', null, routes ? `пикер: ${SLOT_COPY[routes.active]}` : '')),
      routes && ['cheap', 'expensive'].map((kind) => React.createElement('div', { key: kind, className: 'wx-routes-row' },
        React.createElement('span', { className: 'wx-routes-dot', 'data-slot': kind }),
        React.createElement('div', { className: 'wx-routes-role' },
          React.createElement('div', { className: 'wx-routes-name' }, SLOT_COPY[kind]),
          React.createElement('div', { className: 'wx-routes-sub' }, SLOT_ROLE[kind])),
        React.createElement('button', {
          type: 'button',
          className: 'wx-routes-model',
          onClick: () => setPicking((value) => (value === kind ? null : kind)),
        }, routes[kind].model),
        React.createElement('span', { className: 'wx-routes-caret' }, picking === kind ? '▴' : '▾'))),
      props.error && React.createElement('div', { className: 'wx-routes-foot' }, props.error),
      React.createElement('div', { className: 'wx-routes-foot' },
        `Диалог всегда дешёвый${routes ? `: ${routes.cheap.model}` : ''}. Переключение маршрутов не пишет ничего в чат.`),
      picking && React.createElement('div', { className: 'wx-routes-pick' },
        models.length === 0 && React.createElement('div', { className: 'wx-routes-option' }, 'Каталог моделей недоступен'),
        models.map((group) => group.models.map((model) => React.createElement('button', {
          key: `${group.id}/${model.id}`,
          type: 'button',
          className: 'wx-routes-option',
          onClick: () => { void choose(group.id, model.id) },
        }, model.name, React.createElement('small', null, model.id))))))
  )
}

export const inject = ['slots', 'connection']

export function apply(ctx) {
  ctx.effect(() => {
    const el = document.createElement('style')
    el.setAttribute('data-witches-experts', '')
    el.textContent = CSS
    document.head.appendChild(el)
    return () => { el.remove() }
  }, 'witches-experts: styles')

  ctx.slots.inject('conversation.input.right', () => {
    return ctx.slots.register({
      name: 'conversation.input.right',
      id: 'witches-route-panel',
      order: 100,
      label: 'Маршруты исполнителей',
    }, function WitchesRoutesSeat(props) {
      const sessionId = props.sessionId
      const [routes, setRoutes] = React.useState(undefined)
      const [models, setModels] = React.useState([])
      const [error, setError] = React.useState('')

      const refresh = React.useCallback(async () => {
        if (!sessionId) { setError('сессия не выбрана'); return }
        try {
          const { result } = await ctx.connection.api.sessions.models({ sessionId })
          if (!result || !result.ok) {
            setRoutes(undefined)
            setError(result && result.error ? `${result.error.code}: ${result.error.message}` : 'маршруты недоступны')
            return
          }
          setRoutes(result.value.witchRoutes)
          setError(result.value.witchRoutes ? '' : 'развёртывание без двухслотовных маршрутов')
          setModels(result.value.groups.map((group) => ({
            id: group.id,
            models: group.models.map((model) => ({ id: model.id, name: model.name })),
          })))
        } catch (cause) { setRoutes(undefined); setError(String(cause && cause.message ? cause.message : cause)) }
      }, [sessionId])

      React.useEffect(() => { void refresh() }, [refresh])

      return React.createElement(RoutesPanel, {
        routes,
        models,
        error,
        onOpen: () => { void refresh() },
        onSelectSlot: async (kind, selection) => {
          if (!sessionId) return
          const { result } = await ctx.connection.api.sessions.selectModel({ sessionId, provider: selection.provider, model: selection.model, witchSlot: kind })
          if (!result || !result.ok) return
          await refresh()
        },
      })
    })
  })
}