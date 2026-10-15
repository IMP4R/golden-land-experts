window.__ModuleLoader__.load({ id: "session-lens", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/session-lens/src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var React = __toESM(require("react"), 1);
var CSS = [
  ".sl-card{display:flex;flex-direction:column;gap:8px;font:400 13px/1.5 inherit;color:var(--dsw-alias-label-primary)}",
  ".sl-head{display:flex;align-items:baseline;gap:8px;color:var(--dsw-alias-label-secondary);font-size:12px}",
  ".sl-list{display:flex;flex-direction:column;gap:4px;margin:0;padding:0;list-style:none}",
  ".sl-row{display:flex;flex-direction:column;gap:2px;padding:4px 6px;border-radius:6px}",
  ".sl-row:hover{background:var(--dsw-alias-bg-layer-2)}",
  ".sl-rowmain{display:flex;align-items:baseline;gap:8px;flex-wrap:wrap}",
  ".sl-link{border:none;background:transparent;padding:0;color:var(--dsw-alias-label-primary);font:500 13px/1.5 inherit;text-align:left;cursor:pointer;text-decoration:underline;text-decoration-color:var(--dsw-alias-border-l2);text-underline-offset:2px}",
  ".sl-link:hover{text-decoration-color:currentColor}",
  ".sl-meta{color:var(--dsw-alias-label-secondary);font-size:11px;font-variant-numeric:tabular-nums}",
  ".sl-badge{display:inline-block;padding:0 5px;border-radius:4px;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-secondary);font-size:10px;text-transform:uppercase;letter-spacing:.03em}",
  ".sl-lines{display:flex;flex-direction:column;gap:6px;max-height:360px;overflow:auto}",
  ".sl-line{display:grid;grid-template-columns:52px 68px 1fr;gap:8px;align-items:start}",
  ".sl-seq{color:var(--dsw-alias-label-secondary);font:400 11px/1.6 ui-monospace,monospace;text-align:right}",
  ".sl-role{font-size:11px;color:var(--dsw-alias-label-secondary)}",
  ".sl-text{white-space:pre-wrap;word-break:break-word;color:var(--dsw-alias-label-primary)}",
  ".sl-more{color:var(--dsw-alias-label-secondary);font-size:12px;font-style:italic}",
  // The path wraps instead of truncating: a location the user cannot read in
  // full is not a location, and the interesting part of a session path is its
  // tail — the session id — which an ellipsis hides.
  ".sl-pathrow{display:flex;align-items:center;gap:6px;margin:2px 0 0 0;max-width:100%}",
  ".sl-path{flex:1;min-width:0;font:400 11px/1.5 ui-monospace,monospace;color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);padding:2px 6px;border-radius:4px;word-break:break-all}",
  ".sl-copy{border:1px solid var(--dsw-alias-border-l1);background:transparent;color:var(--dsw-alias-label-secondary);font:500 10px/1.6 inherit;padding:1px 6px;border-radius:4px;cursor:pointer;white-space:nowrap}",
  ".sl-copy:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}",
  ".sl-identity{position:relative;display:flex;align-items:center}",
  ".sl-idbtn{height:24px;padding:0 8px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:500 11px/1 ui-monospace,monospace;cursor:pointer}",
  ".sl-idbtn:hover{color:var(--dsw-alias-label-primary);border-color:var(--dsw-alias-border-l2)}",
  // The popover hangs from the header, which sits under the frame's own
  // stacking context; a low z-index lets a side panel paint over it.
  ".sl-idpop{position:fixed;top:56px;left:24px;z-index:9999;width:min(620px,calc(100vw - 48px));max-height:60vh;overflow:auto;display:flex;flex-direction:column;gap:8px;padding:10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);box-shadow:0 8px 28px rgb(0 0 0 / 22%)}",
  ".sl-idrow{display:flex;align-items:center;gap:8px}",
  ".sl-idlabel{flex:0 0 40px;color:var(--dsw-alias-label-secondary);font-size:11px}",
  ".sl-idhint{color:var(--dsw-alias-label-secondary);font-size:11px;line-height:1.5}"
].join("");
function resultText(block) {
  const content = block?.result?.content ?? block?.content;
  if (!Array.isArray(content)) return void 0;
  for (const part of content) {
    if (part && part.type === "text" && typeof part.text === "string") return part.text;
  }
  return void 0;
}
function resultJson(block) {
  const text = resultText(block);
  if (typeof text !== "string") return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function sessionPath(id, cwd) {
  if (typeof cwd !== "string" || cwd.length === 0) return id;
  const slug = cwd.replace(/^\//, "").replace(/\//g, "-");
  return `$DSH_HOME/sessions/-${slug}/${id}/session.jsonl.zstd`;
}
function shortId(id) {
  const match = /^session-([0-9a-f]{8})/i.exec(String(id));
  return match ? match[1] : String(id).slice(0, 12);
}
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
function SessionLink(props) {
  const { id, label, meta, badge, path, onOpen } = props;
  const [copied, setCopied] = React.useState("");
  const copy = async (what, text) => {
    const ok = await copyText(text);
    setCopied(ok ? what : `${what}:error`);
    window.setTimeout(() => setCopied(""), 1500);
  };
  return React.createElement(
    "li",
    { className: "sl-row" },
    React.createElement(
      "div",
      { className: "sl-rowmain" },
      React.createElement("button", {
        type: "button",
        className: "sl-link",
        title: `\u041E\u0442\u043A\u0440\u044B\u0442\u044C \u0441\u0435\u0441\u0441\u0438\u044E ${id}`,
        onClick: () => onOpen(id)
      }, label || shortId(id)),
      badge ? React.createElement("span", { className: "sl-badge" }, badge) : null,
      meta ? React.createElement("span", { className: "sl-meta" }, meta) : null
    ),
    path ? React.createElement(
      "div",
      { className: "sl-pathrow" },
      React.createElement("code", { className: "sl-path", title: path }, path),
      React.createElement("button", {
        type: "button",
        className: "sl-copy",
        title: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C \u043F\u0443\u0442\u044C \u043A \u0444\u0430\u0439\u043B\u0443 \u0441\u0435\u0441\u0441\u0438\u0438",
        onClick: () => copy("path", path)
      }, copied === "path" ? "\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E" : copied === "path:error" ? "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C" : "\u043F\u0443\u0442\u044C"),
      React.createElement("button", {
        type: "button",
        className: "sl-copy",
        title: "\u0421\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C id \u0441\u0435\u0441\u0441\u0438\u0438",
        onClick: () => copy("id", id)
      }, copied === "id" ? "\u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D\u043E" : copied === "id:error" ? "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C" : "id")
    ) : null
  );
}
function SessionMapView(props) {
  const data = resultJson(props.block);
  const open = props.openSession;
  if (data === void 0) return null;
  const sessions = Array.isArray(data.sessions) ? data.sessions : [];
  return React.createElement(
    "div",
    { className: "sl-card" },
    React.createElement(
      "div",
      { className: "sl-head" },
      React.createElement("span", null, `${data.returned ?? sessions.length} \u0438\u0437 ${data.total ?? "?"} \u0441\u0435\u0441\u0441\u0438\u0439`),
      data.searchedBodies === true ? React.createElement("span", { className: "sl-badge" }, "\u043F\u043E\u0438\u0441\u043A \u043F\u043E \u0442\u0435\u043B\u0443") : null
    ),
    React.createElement("ul", { className: "sl-list" }, ...sessions.map(
      (session) => React.createElement(SessionLink, {
        key: session.id,
        id: session.id,
        label: session.title || shortId(session.id),
        badge: session.origin === "subagent" ? "\u044D\u043A\u0441\u043F\u0435\u0440\u0442" : void 0,
        path: session.path,
        meta: [
          session.events !== void 0 ? `${session.events} \u0441\u0442\u0440\u043E\u043A` : void 0,
          session.why,
          session.agentPreset
        ].filter(Boolean).join(" \xB7 "),
        onOpen: open
      })
    ))
  );
}
function SessionTailView(props) {
  const data = resultJson(props.block);
  const open = props.openSession;
  if (data === void 0) return null;
  const lines = Array.isArray(data.lines) ? data.lines : [];
  return React.createElement(
    "div",
    { className: "sl-card" },
    React.createElement(
      "div",
      { className: "sl-head" },
      React.createElement("button", {
        type: "button",
        className: "sl-link",
        onClick: () => open(data.sessionId)
      }, data.sessionId ? shortId(data.sessionId) : "\u0441\u0435\u0441\u0441\u0438\u044F"),
      React.createElement("span", null, `seq ${data.fromSeq}\u2013${data.toSeq}`),
      React.createElement("span", null, `${data.chars ?? 0} \u0441\u0438\u043C\u0432.`),
      data.hasMore === true ? React.createElement("span", { className: "sl-badge" }, "\u0435\u0441\u0442\u044C \u0435\u0449\u0451") : null
    ),
    React.createElement("div", { className: "sl-lines" }, ...lines.map(
      (line) => React.createElement(
        "div",
        { className: "sl-line", key: `${line.seq}-${line.role}` },
        React.createElement("span", { className: "sl-seq" }, String(line.seq)),
        React.createElement("span", { className: "sl-role" }, line.role),
        React.createElement("span", { className: "sl-text" }, line.text)
      )
    )),
    data.hasMore === true ? React.createElement("div", { className: "sl-more" }, `\u0440\u0430\u043D\u044C\u0448\u0435: beforeSeq=${data.nextBeforeSeq}`) : null
  );
}
var inject = ["slots", "sessions"];
function apply(ctx) {
  ctx.effect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-session-lens", "");
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, "session-lens: styles");
  const openSession = (id) => {
    if (typeof id !== "string" || id.length === 0) return;
    try {
      ctx.sessions.open(id);
    } catch (error) {
      ctx.logger?.warn?.(`session-lens: cannot open ${id}: ${String(error)}`);
    }
  };
  ctx.slots.inject("conversation.session.header.actions", () => ctx.slots.register({
    name: "conversation.session.header.actions",
    id: "session-lens-identity",
    order: 5,
    label: "\u0421\u0435\u0441\u0441\u0438\u044F"
  }, function SessionIdentityAction(props) {
    const sessionId = String(props.sessionId ?? "");
    const list = props.useSessions((state) => state.byId[sessionId]);
    const cwd = list?.cwd;
    const [copied, setCopied] = React.useState("");
    const [open, setOpen] = React.useState(false);
    if (sessionId.length === 0) return null;
    const copy = async (what, text) => {
      const ok = await copyText(text);
      setCopied(ok ? what : `${what}:error`);
      window.setTimeout(() => setCopied(""), 1500);
    };
    const label = copied === "id" ? "id \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D" : copied === "id:error" ? "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C" : copied === "path" ? "\u043F\u0443\u0442\u044C \u0441\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u043D" : copied === "path:error" ? "\u043D\u0435 \u0443\u0434\u0430\u043B\u043E\u0441\u044C" : shortId(sessionId);
    return React.createElement(
      "div",
      { className: "sl-identity" },
      React.createElement("button", {
        type: "button",
        className: "sl-idbtn",
        title: `\u0422\u0435\u043A\u0443\u0449\u0430\u044F \u0441\u0435\u0441\u0441\u0438\u044F: ${sessionId}
\u041D\u0430\u0436\u043C\u0438\u0442\u0435, \u0447\u0442\u043E\u0431\u044B \u043F\u043E\u043A\u0430\u0437\u0430\u0442\u044C \u043F\u0443\u0442\u044C \u043A \u0444\u0430\u0439\u043B\u0443`,
        onClick: () => setOpen((v) => !v)
      }, label),
      open ? React.createElement(
        "div",
        { className: "sl-idpop" },
        React.createElement(
          "div",
          { className: "sl-idrow" },
          React.createElement("span", { className: "sl-idlabel" }, "id"),
          React.createElement("code", { className: "sl-path" }, sessionId),
          React.createElement("button", {
            type: "button",
            className: "sl-copy",
            onClick: () => copy("id", sessionId)
          }, "\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C")
        ),
        React.createElement(
          "div",
          { className: "sl-idrow" },
          React.createElement("span", { className: "sl-idlabel" }, "\u0444\u0430\u0439\u043B"),
          React.createElement("code", { className: "sl-path" }, sessionPath(sessionId, cwd)),
          React.createElement("button", {
            type: "button",
            className: "sl-copy",
            onClick: () => copy("path", sessionPath(sessionId, cwd))
          }, "\u043A\u043E\u043F\u0438\u0440\u043E\u0432\u0430\u0442\u044C")
        ),
        React.createElement(
          "div",
          { className: "sl-idhint" },
          "\u041F\u0435\u0440\u0435\u0434\u0430\u0439\u0442\u0435 id \u0438\u043B\u0438 \u043F\u0443\u0442\u044C \u0434\u0440\u0443\u0433\u043E\u0439 \u0441\u0435\u0441\u0441\u0438\u0438, \u0447\u0442\u043E\u0431\u044B \u043E\u043D\u0430 \u043F\u0440\u043E\u0447\u0438\u0442\u0430\u043B\u0430 \u044D\u0442\u0443: session_tail / session_find / session_digest."
        )
      ) : null
    );
  }));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "session_map"
  }, function SessionMapSeat(props) {
    return React.createElement(SessionMapView, { block: props.block, openSession });
  }));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "session_tail"
  }, function SessionTailSeat(props) {
    return React.createElement(SessionTailView, { block: props.block, openSession });
  }));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "session_find"
  }, function SessionFindSeat(props) {
    const data = resultJson(props.block);
    if (data === void 0) return null;
    const hits = Array.isArray(data.hits) ? data.hits : [];
    return React.createElement(
      "div",
      { className: "sl-card" },
      React.createElement(
        "div",
        { className: "sl-head" },
        React.createElement("button", {
          type: "button",
          className: "sl-link",
          onClick: () => openSession(data.sessionId)
        }, data.sessionId ? shortId(data.sessionId) : "\u0441\u0435\u0441\u0441\u0438\u044F"),
        React.createElement("span", null, `${hits.length} \u0441\u043E\u0432\u043F\u0430\u0434\u0435\u043D\u0438\u0439`)
      ),
      React.createElement("div", { className: "sl-lines" }, ...hits.map(
        (hit) => React.createElement(
          "div",
          { className: "sl-line", key: `${hit.seq}-${hit.at}` },
          React.createElement("span", { className: "sl-seq" }, String(hit.seq)),
          React.createElement("span", { className: "sl-role" }, hit.role),
          React.createElement("span", { className: "sl-text" }, hit.excerpt)
        )
      ))
    );
  }));
  ctx.slots.inject("tool.call.toolview", () => ctx.slots.register({
    name: "tool.call.toolview",
    key: "session_digest"
  }, function SessionDigestSeat(props) {
    const data = resultJson(props.block);
    if (data === void 0) return null;
    return React.createElement(
      "div",
      { className: "sl-card" },
      React.createElement(
        "div",
        { className: "sl-head" },
        React.createElement("button", {
          type: "button",
          className: "sl-link",
          onClick: () => openSession(data.sessionId)
        }, data.sessionId ? shortId(data.sessionId) : "\u0441\u0435\u0441\u0441\u0438\u044F"),
        React.createElement("span", null, `${data.digestedChunks ?? 0} \u0438\u0437 ${data.totalChunks ?? 0} \u0444\u0440\u0430\u0433\u043C\u0435\u043D\u0442\u043E\u0432`),
        React.createElement("span", null, data.route),
        React.createElement("span", { className: "sl-badge" }, "\u043A\u0430\u0440\u0442\u0430")
      ),
      React.createElement("div", { className: "sl-text" }, data.map || "(\u043F\u0443\u0441\u0442\u043E)")
    );
  }));
}
return module.exports; } });
