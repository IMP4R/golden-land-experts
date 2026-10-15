// ============================================================================
// golden-land-graphiti-lifecycle — automatic memory lifecycle over Graphiti.
// ============================================================================
// Variant B of the Graphiti integration: the harness session drives recall
// and capture instead of relying on manual tool calls.
//
//   agent/pre-step  → search_nodes for the claimed user messages; append a
//                     bounded, plugin-attributed durable context message.
//   turn/end        → add_memory one episode per completed turn (recent
//                     user prompt + assistant text), bounded.
//
// Transport: stateless JSON-RPC against the local Graphiti MCP server
// (initialize once per client, tools/call reuses the session). Any failure
// degrades to a logged no-op; it never fails the agent step.
// ============================================================================
import { createHash, randomUUID } from 'node:crypto';
import { Ledger } from '../memory/ledger.mjs';

export const name = 'golden-land-graphiti-lifecycle';
export const inject = [];

const DEFAULTS = {
  endpoint: 'http://127.0.0.1:8120/mcp',
  groupId: 'golden-land-new',
  maxRecallChars: 1500,
  maxEpisodeChars: 6000,
};

function resolveConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  return {
    endpoint: typeof src.endpoint === 'string' ? src.endpoint : DEFAULTS.endpoint,
    groupId: typeof src.groupId === 'string' ? src.groupId : DEFAULTS.groupId,
    maxRecallChars: Number.isSafeInteger(src.maxRecallChars) ? src.maxRecallChars : DEFAULTS.maxRecallChars,
    maxEpisodeChars: Number.isSafeInteger(src.maxEpisodeChars) ? src.maxEpisodeChars : DEFAULTS.maxEpisodeChars,
  };
}

async function createClient(endpoint) {
  const initRes = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 0, method: 'initialize',
      params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'golden-land-lifecycle', version: '0.1.0' } },
    }),
  });
  if (!initRes.ok) throw new Error(`graphiti initialize HTTP ${initRes.status}`);
  const sid = initRes.headers.get('mcp-session-id');
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    ...(sid ? { 'mcp-session-id': sid } : {}),
  };
  await fetch(endpoint, {
    method: 'POST', headers,
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
  });
  let nextId = 0;
  return async function callTool(toolName, args) {
    nextId += 1;
    const res = await fetch(endpoint, {
      method: 'POST', headers,
      body: JSON.stringify({ jsonrpc: '2.0', id: nextId, method: 'tools/call', params: { name: toolName, arguments: args } }),
    });
    if (!res.ok) throw new Error(`graphiti ${toolName} HTTP ${res.status}`);
    const raw = await res.text();
    // Streamable HTTP answers as SSE ("data: {...}") or plain JSON.
    const dataLine = raw.split('\n').find(l => l.startsWith('data: '));
    const payload = dataLine ? JSON.parse(dataLine.slice(6)) : JSON.parse(raw);
    if (payload.error) throw new Error(`graphiti ${toolName}: ${payload.error.message ?? 'error'}`);
    return payload.result;
  };
}

function textOfContent(content) {
  return (content || []).map(b => (b && b.type === 'text') ? b.text : '').join('');
}

function pluginMessage(text, form) {
  return {
    role: 'user',
    // Persisted user/messages must carry an id (resume invariant); DSH core
    // does not assign ids to plugin-injected messages.
    id: `msg-${randomUUID()}`,
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: name, form },
  };
}

export function apply(ctx, config) {
  const cfg = resolveConfig(config);
  let call = null;
  const ready = createClient(cfg.endpoint).then(c => { call = c; }, () => {});
  let degradedRecall = false;
  let degradedCapture = false;
  // Nodes injected by the most recent recall — recorded with each capture so
  // the ledger can connect an episode to the context that shaped it. Names
  // ride along because raw uuids are almost never quoted back by the model;
  // the quality report matches citations by token overlap instead.
  const lastRecall = { nodeIds: [], nodes: [] };
  const captureLedger = new Ledger();
  const pendingCaptures = new Set();

  const DEBUG = process.env.GOLDEN_LAND_LIFECYCLE_DEBUG === '1';
  const debug = (...a) => { if (DEBUG) console.log('[lifecycle]', ...a); };
  const degrade = (kind, error) => {
    if (kind === 'recall' ? degradedRecall : degradedCapture) return;
    if (kind === 'recall') degradedRecall = true; else degradedCapture = true;
    ctx.logger?.warn?.(`${name}: ${kind} degraded: ${String(error?.message ?? error)}`);
  };

  // ── pre-step recall ──────────────────────────────────────────────────────
  ctx.on('agent/pre-step', async ({ signal }, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== 'enter' || signal.aborted) return decision;
      const prompts = (decision.messages || [])
        .filter(m => m.role === 'user' && m.source?.kind !== 'plugin')
        .map(m => Array.isArray(m.content)
          ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
          : '')
        .filter(t => t.trim().length > 0);
      if (prompts.length === 0) return decision;
      const query = prompts.at(-1).slice(0, 400);
      const result = await (async () => { await ready; return call('search_nodes', { query, group_ids: [cfg.groupId], max_nodes: 5 }); })();
      // Prefer the structured node list so each match carries its id, score and
      // an explicit expand path; fall back to raw text when absent.
      let nodes = result?.structuredContent?.nodes ?? null;
      if (!Array.isArray(nodes) || nodes.length === 0) {
        try { nodes = JSON.parse(textOfContent(result?.content))?.nodes ?? null; } catch { nodes = null; }
      }
      lastRecall.nodeIds = [];
      lastRecall.nodes = [];
      let body;
      if (Array.isArray(nodes) && nodes.length > 0) {
        const lines = [];
        for (const n of nodes.slice(0, 5)) {
          const id = n.uuid ?? n.id ?? '';
          const name = String(n.name ?? '');
          lastRecall.nodeIds.push(id);
          lastRecall.nodes.push({ id, name });
          const score = Number.isFinite(Number(n.score)) ? ` score=${Number(n.score).toFixed(2)}` : '';
          // Temporal surfacing: Graphiti carries validity on edges; when the
          // projection includes it, show the window inline.
          const from = n.valid_at ?? n.createdAt ?? null;
          const until = n.invalid_at ?? null;
          const temporal = from ? ` valid=${String(from).slice(0, 10)}→${until ? String(until).slice(0, 10) : 'now'}` : '';
          const summary = String(n.summary ?? '').slice(0, 300);
          lines.push(`1. [node:${id}]${score}${temporal} ${name}\n   ${summary}`);
        }
        body = lines.join('\n').slice(0, cfg.maxRecallChars);
      } else {
        body = textOfContent(result?.content).slice(0, cfg.maxRecallChars);
      }
      if (!body.trim()) return decision;
      const recall = pluginMessage(
        `<system-reminder>Graphiti memory for the current user request "${query.slice(0, 120)}" — semantic matches from group ${cfg.groupId}. Use relevant matches as prior context, not as verified current state. If a match changes the answer or conflicts with current evidence, expand it with mcp__graphiti__get_episodes or search_nodes and prefer the newer sourced fact. Do not mention this internal recall unless provenance matters to the user.\n${body}\n</system-reminder>`,
        'recall',
      );
      debug('recall injected', { query_chars: query.length, nodes: lastRecall.nodeIds.length });
      return { kind: 'enter', messages: [...decision.messages, recall] };
    } catch (error) {
      degrade('recall', error);
      return decision;
    }
  }, { prepend: true });

  // ── turn-end capture ─────────────────────────────────────────────────────
  // dsh appends durable 'assistant/message' when the model finishes a message;
  // that is the reliable end-of-turn anchor. The paired user prompt is the
  // latest 'user/message' earlier in the session.
  ctx.on('session/event', (session, event) => {
    debug('session/event', event.type);
    if (event.type !== 'assistant/message') return;
    if (event.data?.interrupted) return;
    const capture = (async () => {
      try {
        const events = session.events ?? [];
        const idx = events.findIndex(e => e.seq === event.seq);
        const before = idx >= 0 ? events.slice(0, idx) : events;
        let userText = '';
        for (let i = before.length - 1; i >= 0 && !userText; i -= 1) {
          const e = before[i];
          if (e.type !== 'user/message') continue;
          const m = e.data?.message ?? e.data;
          userText = (m?.content ?? [])
            .filter(b => b.type === 'text')
            .map(b => b.text)
            .join(' ')
            .trim();
        }
        const assistantText = (event.data?.message?.content ?? [])
          .filter(b => b.type === 'text')
          .map(b => b.text)
          .join(' ')
          .trim();
        if (!assistantText && !userText) return;
        const half = Math.floor(cfg.maxEpisodeChars / 2);
        const body = [
          userText ? `user: ${userText.slice(0, half)}` : '',
          assistantText ? `assistant: ${assistantText.slice(0, half)}` : '',
        ].filter(Boolean).join('\n');
        debug('capturing episode, body chars:', body.length);
        // Provenance journaling first: the headless process may exit while the
        // queued Graphiti extraction is still running server-side.
        try {
          await captureLedger.append('capture', {
            session_id: session.id,
            episode_body_sha256: createHash('sha256').update(body).digest('hex'),
            assistant_excerpt: assistantText.slice(0, 2000),
            recalled_node_ids: [...lastRecall.nodeIds],
            recalled_nodes: lastRecall.nodes.map(n => ({ id: n.id, name: n.name })),
          });
          debug('ledger capture recorded', { recalled_nodes: lastRecall.nodeIds.length });
          lastRecall.nodeIds = [];
        } catch (ledgerError) {
          ctx.logger?.warn?.(`${name}: ledger capture failed: ${String(ledgerError?.message ?? ledgerError)}`);
        }
        await (async () => { await ready; return call('add_memory', {
          name: `session ${session.id} turn`,
          episode_body: body,
          group_id: cfg.groupId,
          source: 'text',
          source_description: 'golden-land automatic turn capture',
        }); })();
      } catch (error) {
        degrade('capture', error);
      }
    })();
    pendingCaptures.add(capture);
    void capture.finally(() => pendingCaptures.delete(capture));
  });

  // Headless sessions may dispose immediately after turn/end. Flush keeps the
  // asynchronous Graphiti write and its matching provenance record durable.
  ctx.on('session/flush', async () => {
    await Promise.allSettled([...pendingCaptures]);
  });
}
