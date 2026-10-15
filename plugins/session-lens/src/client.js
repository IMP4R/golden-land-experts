// Client half of session-lens: clickable session references.
//
// The host half answers questions about other sessions; this half makes the
// answers navigable. Three seats, each doing one thing:
//
//  - `tool.call.toolview` for `session_map` renders each listed session as a
//    link that opens it, so a map is a table of contents rather than a wall of
//    ids the user must copy by hand.
//  - `tool.call.toolview` for `session_tail` renders the lines it read with
//    their seq numbers, so the user can see exactly what the model paid for.
//  - `conversation.session.header.actions` adds one button that opens the map
//    for the current session without typing anything.
//
// Opening a session goes through `ctx.sessions.open(id)`, the shell's own
// selection path, so the result is indistinguishable from clicking the session
// in the sidebar.

import * as React from 'react'

// Every colour comes from a theme token. A hardcoded fallback would look
// correct in the theme it was written against and wrong in the other, which is
// exactly the bug this replaces: a dark popover on a light page.
const CSS = [
  '.sl-card{display:flex;flex-direction:column;gap:8px;font:400 13px/1.5 inherit;color:var(--dsw-alias-label-primary)}',
  '.sl-head{display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}',
  '.sl-list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}',
  '.sl-row{display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-radius:6px}',
  '.sl-row:hover{background:var(--dsw-alias-bg-layer-2)}',
  '.sl-rowmain{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}',
  '.sl-link{border:none;background:transparent;padding:0;color:var(--dsw-alias-label-primary);font:500 13px/1.5 inherit;text-align:left;cursor:pointer;text-decoration:underline;text-decoration-color:var(--dsw-alias-border-l2);text-underline-offset:2px}',
  '.sl-link:hover{text-decoration-color:currentColor}',
  '.sl-meta{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}',
  '.sl-badge{display:inline-block;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase;letter-spacing:.03em}',
  '.sl-lines{display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}',
  '.sl-line{display:grid;grid-template-columns:52px 68px 1fr;gap:8px;align-items:start}',
  '.sl-seq{color:var(--dsw-alias-label-secondary);font:400 11px/1.6 ui-monospace,monospace;text-align:right}',
  '.sl-role{font-size:11px;color:var(--dsw-alias-label-secondary)}',
  '.sl-text{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}',
  '.sl-more{color:var(--dsw-alias-label-secondary);font-size:12px;font-style:italic}',
  // The path wraps instead of truncating: a location the user cannot read in
  // full is not a location, and the interesting part of a session path is its
  // tail — the session id — which an ellipsis hides.
  '.sl-pathrow{display:flex;align-items:center;gap:6px;margin:2px 0 0 0;max-width:100%}',
  '.sl-path{flex:1;min-width:0;font:400 11px/1.5 ui-monospace,monospace;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);padding:2px 6px;border-radius:4px;word-break:break-all}',
  '.sl-copy{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:500 10px/1.6 inherit;padding:1px 6px;border-radius:4px;cursor:pointer;white-space:nowrap}',
  '.sl-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
  '.sl-identity{position:relative;display:flex;align-items:center}',
  '.sl-idbtn{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:500 11px/1 ui-monospace,monospace;cursor:pointer}',
  '.sl-idbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}',
  // The popover hangs from the header, which sits under the frame's own
  // stacking context; a low z-index lets a side panel paint over it.
  '.sl-idpop{position:fixed;top:56px;left:24px;z-index:9999;width:min(620px,calc(100vw - 48px));max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 8px 28px rgb(0 0 0 / 22%)}',
  '.sl-idrow{display:flex;align-items:center;gap:8px}',
  '.sl-idlabel{flex:0 0 40px;color:var(--dsw-alias-label-secondary);font-size:11px}',
  '.sl-idhint{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}',
].join('')

/** Read a settled tool result's text, whichever envelope it arrived in. */
function resultText(block) {
  const content = block?.result?.content ?? block?.content
  if (!Array.isArray(content)) return undefined
  for (const part of content) {
    if (part && part.type === 'text' && typeof part.text === 'string') return part.text
  }
  return undefined
}

/** Parse a tool result as JSON, tolerating a non-JSON body. */
function resultJson(block) {
  const text = resultText(block)
  if (typeof text !== 'string') return undefined
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

/**
 * Where one session's log lives on disk, from the session's own cwd.
 *
 * The store lays a session out under a slug of its working directory, so the
 * path is derived from the session's real cwd rather than a hardcoded slug —
 * a hardcoded one would silently name the wrong file for any other workspace.
 * The persistence backend remains authoritative; this is what the header can
 * show before any tool has run.
 * @param id - the session id.
 * @param cwd - the session's working directory, when the list knows it.
 * @returns the expected path, or the id alone when the cwd is unknown.
 */
function sessionPath(id, cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return id
  const slug = cwd.replace(/^\//, '').replace(/\//g, '-')
  return `$DSH_HOME/sessions/-${slug}/${id}/session.jsonl.zstd`
}

/**
 * A session id shortened to the part that distinguishes it.
 *
 * Ids share the `session-` prefix and differ in the middle, so a leading slice
 * renders every link identically. The first UUID group is short and unique
 * enough to tell sessions apart at a glance.
 * @param id - the full session id.
 * @returns a readable short form.
 */
function shortId(id) {
  const match = /^session-([0-9a-f]{8})/i.exec(String(id))
  return match ? match[1] : String(id).slice(0, 12)
}

/**
 * Copy one string to the clipboard, reporting success.
 *
 * The clipboard API needs a secure context and can be denied; a silent failure
 * would leave the user believing a path was copied when it was not, so the
 * result is returned and shown.
 * @param text - the exact string to copy.
 * @returns whether the copy succeeded.
 */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

/** One session reference: its link, its file path, and a copy control. */
function SessionLink(props) {
  const { id, label, meta, badge, path, onOpen } = props
  const [copied, setCopied] = React.useState('')
  const copy = async (what, text) => {
    const ok = await copyText(text)
    setCopied(ok ? what : `${what}:error`)
    window.setTimeout(() => setCopied(''), 1500)
  }
  return React.createElement('li', { className: 'sl-row' },
    React.createElement('div', { className: 'sl-rowmain' },
      React.createElement('button', {
        type: 'button',
        className: 'sl-link',
        title: `Открыть сессию ${id}`,
        onClick: () => onOpen(id),
      }, label || shortId(id)),
      badge ? React.createElement('span', { className: 'sl-badge' }, badge) : null,
      meta ? React.createElement('span', { className: 'sl-meta' }, meta) : null,
    ),
    path
      ? React.createElement('div', { className: 'sl-pathrow' },
          React.createElement('code', { className: 'sl-path', title: path }, path),
          React.createElement('button', {
            type: 'button',
            className: 'sl-copy',
            title: 'Скопировать путь к файлу сессии',
            onClick: () => copy('path', path),
          }, copied === 'path' ? 'скопировано' : copied === 'path:error' ? 'не удалось' : 'путь'),
          React.createElement('button', {
            type: 'button',
            className: 'sl-copy',
            title: 'Скопировать id сессии',
            onClick: () => copy('id', id),
          }, copied === 'id' ? 'скопировано' : copied === 'id:error' ? 'не удалось' : 'id'),
        )
      : null,
  )
}

/** Render `session_map` as a table of contents. */
function SessionMapView(props) {
  const data = resultJson(props.block)
  const open = props.openSession
  if (data === undefined) return null
  const sessions = Array.isArray(data.sessions) ? data.sessions : []
  return React.createElement('div', { className: 'sl-card' },
    React.createElement('div', { className: 'sl-head' },
      React.createElement('span', null, `${data.returned ?? sessions.length} из ${data.total ?? '?'} сессий`),
      data.searchedBodies === true ? React.createElement('span', { className: 'sl-badge' }, 'поиск по телу') : null,
    ),
    React.createElement('ul', { className: 'sl-list' }, ...sessions.map(session =>
      React.createElement(SessionLink, {
        key: session.id,
        id: session.id,
        label: session.title || shortId(session.id),
        badge: session.origin === 'subagent' ? 'эксперт' : undefined,
        path: session.path,
        meta: [
          session.events !== undefined ? `${session.events} строк` : undefined,
          session.why,
          session.agentPreset,
        ].filter(Boolean).join(' · '),
        onOpen: open,
      }),
    )),
  )
}

/** Render `session_tail` as the lines that were actually read. */
function SessionTailView(props) {
  const data = resultJson(props.block)
  const open = props.openSession
  if (data === undefined) return null
  const lines = Array.isArray(data.lines) ? data.lines : []
  return React.createElement('div', { className: 'sl-card' },
    React.createElement('div', { className: 'sl-head' },
      React.createElement('button', {
        type: 'button',
        className: 'sl-link',
        onClick: () => open(data.sessionId),
      }, data.sessionId ? shortId(data.sessionId) : 'сессия'),
      React.createElement('span', null, `seq ${data.fromSeq}–${data.toSeq}`),
      React.createElement('span', null, `${data.chars ?? 0} симв.`),
      data.hasMore === true ? React.createElement('span', { className: 'sl-badge' }, 'есть ещё') : null,
    ),
    React.createElement('div', { className: 'sl-lines' }, ...lines.map(line =>
      React.createElement('div', { className: 'sl-line', key: `${line.seq}-${line.role}` },
        React.createElement('span', { className: 'sl-seq' }, String(line.seq)),
        React.createElement('span', { className: 'sl-role' }, line.role),
        React.createElement('span', { className: 'sl-text' }, line.text),
      ),
    )),
    data.hasMore === true
      ? React.createElement('div', { className: 'sl-more' }, `раньше: beforeSeq=${data.nextBeforeSeq}`)
      : null,
  )
}

// `useSessions` is NOT injected: it is a hook handed to every slot occupant
// through props, not a service. Injecting it leaves the plugin pending forever
// waiting for a service that never registers.
export const inject = ['slots', 'sessions']

export function apply(ctx) {
  ctx.effect(() => {
    const el = document.createElement('style')
    el.setAttribute('data-session-lens', '')
    el.textContent = CSS
    document.head.appendChild(el)
    return () => { el.remove() }
  }, 'session-lens: styles')

  const openSession = (id) => {
    if (typeof id !== 'string' || id.length === 0) return
    try {
      ctx.sessions.open(id)
    } catch (error) {
      // An id the list no longer holds fails loud in the service; a stale link
      // in an old transcript is not a reason to break the view.
      ctx.logger?.warn?.(`session-lens: cannot open ${id}: ${String(error)}`)
    }
  }

  /**
   * The session's own identity, in the header where it is always visible.
   *
   * A reference is only useful if the user can READ it without running a tool
   * first: telling another session "read that one" requires knowing which one
   * this is. The header is the one place that is true for the whole session,
   * so the id and its file path live there rather than inside a tool card.
   */
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'session-lens-identity',
    order: 5,
    label: 'Сессия',
  }, function SessionIdentityAction(props) {
    const sessionId = String(props.sessionId ?? '')
    const list = props.useSessions(state => state.byId[sessionId])
    const cwd = list?.cwd
    const [copied, setCopied] = React.useState('')
    const [open, setOpen] = React.useState(false)
    if (sessionId.length === 0) return null
    const copy = async (what, text) => {
      const ok = await copyText(text)
      setCopied(ok ? what : `${what}:error`)
      window.setTimeout(() => setCopied(''), 1500)
    }
    const label = copied === 'id' ? 'id скопирован'
      : copied === 'id:error' ? 'не удалось'
        : copied === 'path' ? 'путь скопирован'
          : copied === 'path:error' ? 'не удалось'
            : shortId(sessionId)
    return React.createElement('div', { className: 'sl-identity' },
      React.createElement('button', {
        type: 'button',
        className: 'sl-idbtn',
        title: `Текущая сессия: ${sessionId}\nНажмите, чтобы показать путь к файлу`,
        onClick: () => setOpen(v => !v),
      }, label),
      open
        ? React.createElement('div', { className: 'sl-idpop' },
            React.createElement('div', { className: 'sl-idrow' },
              React.createElement('span', { className: 'sl-idlabel' }, 'id'),
              React.createElement('code', { className: 'sl-path' }, sessionId),
              React.createElement('button', {
                type: 'button',
                className: 'sl-copy',
                onClick: () => copy('id', sessionId),
              }, 'копировать'),
            ),
            React.createElement('div', { className: 'sl-idrow' },
              React.createElement('span', { className: 'sl-idlabel' }, 'файл'),
              React.createElement('code', { className: 'sl-path' }, sessionPath(sessionId, cwd)),
              React.createElement('button', {
                type: 'button',
                className: 'sl-copy',
                onClick: () => copy('path', sessionPath(sessionId, cwd)),
              }, 'копировать'),
            ),
            React.createElement('div', { className: 'sl-idhint' },
              'Передайте id или путь другой сессии, чтобы она прочитала эту: session_tail / session_find / session_digest.'),
          )
        : null,
    )
  }))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'session_map',
  }, function SessionMapSeat(props) {
    return React.createElement(SessionMapView, { block: props.block, openSession })
  }))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'session_tail',
  }, function SessionTailSeat(props) {
    return React.createElement(SessionTailView, { block: props.block, openSession })
  }))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'session_find',
  }, function SessionFindSeat(props) {
    const data = resultJson(props.block)
    if (data === undefined) return null
    const hits = Array.isArray(data.hits) ? data.hits : []
    return React.createElement('div', { className: 'sl-card' },
      React.createElement('div', { className: 'sl-head' },
        React.createElement('button', {
          type: 'button',
          className: 'sl-link',
          onClick: () => openSession(data.sessionId),
        }, data.sessionId ? shortId(data.sessionId) : 'сессия'),
        React.createElement('span', null, `${hits.length} совпадений`),
      ),
      React.createElement('div', { className: 'sl-lines' }, ...hits.map(hit =>
        React.createElement('div', { className: 'sl-line', key: `${hit.seq}-${hit.at}` },
          React.createElement('span', { className: 'sl-seq' }, String(hit.seq)),
          React.createElement('span', { className: 'sl-role' }, hit.role),
          React.createElement('span', { className: 'sl-text' }, hit.excerpt),
        ),
      )),
    )
  }))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview',
    key: 'session_digest',
  }, function SessionDigestSeat(props) {
    const data = resultJson(props.block)
    if (data === undefined) return null
    return React.createElement('div', { className: 'sl-card' },
      React.createElement('div', { className: 'sl-head' },
        React.createElement('button', {
          type: 'button',
          className: 'sl-link',
          onClick: () => openSession(data.sessionId),
        }, data.sessionId ? shortId(data.sessionId) : 'сессия'),
        React.createElement('span', null, `${data.digestedChunks ?? 0} из ${data.totalChunks ?? 0} фрагментов`),
        React.createElement('span', null, data.route),
        React.createElement('span', { className: 'sl-badge' }, 'карта'),
      ),
      React.createElement('div', { className: 'sl-text' }, data.map || '(пусто)'),
    )
  }))
}
