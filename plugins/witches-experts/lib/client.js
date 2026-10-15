window.__ModuleLoader__.load({ id: "witches-experts", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
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

// plugins/witches-experts/src/client.js
var client_exports = {};
__export(client_exports, {
  apply: () => apply,
  inject: () => inject
});
module.exports = __toCommonJS(client_exports);
var React = __toESM(require("react"), 1);
var CSS = '.wx-routes{position:relative}.wx-routes-trigger{display:flex;align-items:center;gap:6px;height:28px;padding:0 10px;border-radius:24px;border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,.12));background:transparent;color:var(--dsw-alias-label-secondary,#9aa3b2);font:500 12px/20px inherit;cursor:pointer;white-space:nowrap}.wx-routes-trigger:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8ecf2)}.wx-routes-dot{width:6px;height:6px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#6b7280)}.wx-routes-dot[data-slot="cheap"]{background:#5aa9e6}.wx-routes-dot[data-slot="expensive"]{background:#c99bf0}.wx-routes-panel{position:absolute;bottom:38px;right:0;z-index:40;width:320px;padding:10px;border-radius:12px;border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,.14));background:var(--dsw-alias-surface-raised,#1b1d22);box-shadow:0 14px 36px rgba(0,0,0,.45)}.wx-routes-head{display:flex;align-items:center;gap:8px;margin-bottom:8px;font:600 12px/16px inherit;color:var(--dsw-alias-label-primary,#e8ecf2);white-space:nowrap}.wx-routes-head span{margin-left:auto;padding:2px 6px;border-radius:10px;background:var(--dsw-alias-surface-sunken, rgba(255,255,255,.05));font:500 10px/14px inherit;color:var(--dsw-alias-label-secondary,#9aa3b2)}.wx-routes-row{display:flex;align-items:center;gap:8px;padding:6px 8px;border-radius:8px}.wx-routes-row:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.05))}.wx-routes-role{display:flex;flex-direction:column;min-width:0;flex:1}.wx-routes-name{font:500 12px/15px inherit;color:var(--dsw-alias-label-primary,#e8ecf2)}.wx-routes-sub{font:400 10px/13px inherit;color:var(--dsw-alias-label-tertiary,#6b7280);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.wx-routes-model{flex:none;max-width:132px;padding:3px 6px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary,#9aa3b2);font:500 12px/15px inherit;cursor:pointer;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.wx-routes-model:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08));color:var(--dsw-alias-label-primary,#e8ecf2)}.wx-routes-caret{font:400 10px/12px inherit;color:var(--dsw-alias-label-tertiary,#6b7280);flex:none}.wx-routes-pick{position:absolute;left:10px;right:10px;bottom:10px;z-index:2;max-height:216px;overflow:auto;padding:4px;border-radius:10px;border:1px solid var(--dsw-alias-border-inverted, rgba(255,255,255,.16));background:var(--dsw-alias-surface-raised,#1b1d22);box-shadow:0 -10px 28px rgba(0,0,0,.45)}.wx-routes-option{display:block;width:100%;text-align:left;padding:6px 8px;border:none;border-radius:6px;background:transparent;color:var(--dsw-alias-label-primary,#e8ecf2);font:400 12px/15px inherit;cursor:pointer}.wx-routes-option:hover{background:var(--dsw-alias-interactive-bg-hover, rgba(255,255,255,.08))}.wx-routes-option small{display:block;color:var(--dsw-alias-label-tertiary,#6b7280)}.wx-routes-foot{margin-top:8px;font:400 10px/14px inherit;color:var(--dsw-alias-label-tertiary,#6b7280)}';
var SLOT_COPY = { cheap: "\u0414\u0435\u0448\u0451\u0432\u0430\u044F", expensive: "\u0414\u043E\u0440\u043E\u0433\u0430\u044F" };
var SLOT_ROLE = {
  cheap: "\u0432\u043E\u0440\u043A\u0435\u0440\u044B",
  expensive: "\u043F\u043B\u0430\u043D \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430"
};
function RoutesPanel(props) {
  const [open, setOpen] = React.useState(false);
  const [picking, setPicking] = React.useState(null);
  const root = React.useRef(null);
  React.useEffect(() => {
    if (!open) return void 0;
    const close = (event) => {
      if (root.current && !root.current.contains(event.target)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);
  const routes = props.routes;
  const models = props.models || [];
  React.useEffect(() => {
    if (open && typeof props.onOpen === "function") props.onOpen();
  }, [open]);
  const choose = async (provider, model) => {
    const kind = picking;
    setPicking(null);
    await props.onSelectSlot(kind, { provider, model });
  };
  const triggerLabel = routes ? routes[routes.active].model : "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B";
  return React.createElement(
    "div",
    { className: "wx-routes", ref: root },
    React.createElement(
      "button",
      {
        type: "button",
        className: "wx-routes-trigger",
        "aria-haspopup": "dialog",
        "aria-expanded": open,
        title: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u0435\u0439: \u0441\u0431\u043E\u0440\u0449\u0438\u043A \u0438 \u0432\u043E\u0440\u043A\u0435\u0440\u044B, \u043F\u043B\u0430\u043D\u0438\u0440\u043E\u0432\u0449\u0438\u043A \u0438 \u043F\u0440\u043E\u0432\u0435\u0440\u043A\u0430",
        onClick: () => setOpen((value) => !value)
      },
      React.createElement("span", { className: "wx-routes-dot", "data-slot": routes ? routes.active : "" }),
      React.createElement("span", null, "\u0418\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u0438 \xB7 "),
      triggerLabel
    ),
    open && React.createElement(
      "div",
      { className: "wx-routes-panel", role: "dialog", "aria-label": "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u0435\u0439" },
      React.createElement(
        "div",
        { className: "wx-routes-head" },
        "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B",
        React.createElement("span", null, routes ? `\u043F\u0438\u043A\u0435\u0440: ${SLOT_COPY[routes.active]}` : "")
      ),
      routes && ["cheap", "expensive"].map((kind) => React.createElement(
        "div",
        { key: kind, className: "wx-routes-row" },
        React.createElement("span", { className: "wx-routes-dot", "data-slot": kind }),
        React.createElement(
          "div",
          { className: "wx-routes-role" },
          React.createElement("div", { className: "wx-routes-name" }, SLOT_COPY[kind]),
          React.createElement("div", { className: "wx-routes-sub" }, SLOT_ROLE[kind])
        ),
        React.createElement("button", {
          type: "button",
          className: "wx-routes-model",
          onClick: () => setPicking((value) => value === kind ? null : kind)
        }, routes[kind].model),
        React.createElement("span", { className: "wx-routes-caret" }, picking === kind ? "\u25B4" : "\u25BE")
      )),
      props.error && React.createElement("div", { className: "wx-routes-foot" }, props.error),
      React.createElement(
        "div",
        { className: "wx-routes-foot" },
        `\u0414\u0438\u0430\u043B\u043E\u0433 \u0432\u0441\u0435\u0433\u0434\u0430 \u0434\u0435\u0448\u0451\u0432\u044B\u0439${routes ? `: ${routes.cheap.model}` : ""}. \u041F\u0435\u0440\u0435\u043A\u043B\u044E\u0447\u0435\u043D\u0438\u0435 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u043E\u0432 \u043D\u0435 \u043F\u0438\u0448\u0435\u0442 \u043D\u0438\u0447\u0435\u0433\u043E \u0432 \u0447\u0430\u0442.`
      ),
      picking && React.createElement(
        "div",
        { className: "wx-routes-pick" },
        models.length === 0 && React.createElement("div", { className: "wx-routes-option" }, "\u041A\u0430\u0442\u0430\u043B\u043E\u0433 \u043C\u043E\u0434\u0435\u043B\u0435\u0439 \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u0435\u043D"),
        models.map((group) => group.models.map((model) => React.createElement("button", {
          key: `${group.id}/${model.id}`,
          type: "button",
          className: "wx-routes-option",
          onClick: () => {
            void choose(group.id, model.id);
          }
        }, model.name, React.createElement("small", null, model.id))))
      )
    )
  );
}
var inject = ["slots", "connection"];
function apply(ctx) {
  ctx.effect(() => {
    const el = document.createElement("style");
    el.setAttribute("data-witches-experts", "");
    el.textContent = CSS;
    document.head.appendChild(el);
    return () => {
      el.remove();
    };
  }, "witches-experts: styles");
  ctx.slots.inject("conversation.input.right", () => {
    return ctx.slots.register({
      name: "conversation.input.right",
      id: "witches-route-panel",
      order: 100,
      label: "\u041C\u0430\u0440\u0448\u0440\u0443\u0442\u044B \u0438\u0441\u043F\u043E\u043B\u043D\u0438\u0442\u0435\u043B\u0435\u0439"
    }, function WitchesRoutesSeat(props) {
      const sessionId = props.sessionId;
      const [routes, setRoutes] = React.useState(void 0);
      const [models, setModels] = React.useState([]);
      const [error, setError] = React.useState("");
      const refresh = React.useCallback(async () => {
        if (!sessionId) {
          setError("\u0441\u0435\u0441\u0441\u0438\u044F \u043D\u0435 \u0432\u044B\u0431\u0440\u0430\u043D\u0430");
          return;
        }
        try {
          const { result } = await ctx.connection.api.sessions.models({ sessionId });
          if (!result || !result.ok) {
            setRoutes(void 0);
            setError(result && result.error ? `${result.error.code}: ${result.error.message}` : "\u043C\u0430\u0440\u0448\u0440\u0443\u0442\u044B \u043D\u0435\u0434\u043E\u0441\u0442\u0443\u043F\u043D\u044B");
            return;
          }
          setRoutes(result.value.witchRoutes);
          setError(result.value.witchRoutes ? "" : "\u0440\u0430\u0437\u0432\u0451\u0440\u0442\u044B\u0432\u0430\u043D\u0438\u0435 \u0431\u0435\u0437 \u0434\u0432\u0443\u0445\u0441\u043B\u043E\u0442\u043E\u0432\u043D\u044B\u0445 \u043C\u0430\u0440\u0448\u0440\u0443\u0442\u043E\u0432");
          setModels(result.value.groups.map((group) => ({
            id: group.id,
            models: group.models.map((model) => ({ id: model.id, name: model.name }))
          })));
        } catch (cause) {
          setRoutes(void 0);
          setError(String(cause && cause.message ? cause.message : cause));
        }
      }, [sessionId]);
      React.useEffect(() => {
        void refresh();
      }, [refresh]);
      return React.createElement(RoutesPanel, {
        routes,
        models,
        error,
        onOpen: () => {
          void refresh();
        },
        onSelectSlot: async (kind, selection) => {
          if (!sessionId) return;
          const { result } = await ctx.connection.api.sessions.selectModel({ sessionId, provider: selection.provider, model: selection.model, witchSlot: kind });
          if (!result || !result.ok) return;
          await refresh();
        }
      });
    });
  });
}
return module.exports; } });
