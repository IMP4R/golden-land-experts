// ============================================================================
// golden-land-context-pack — memory layer L5: one assembled context pack.
// ============================================================================
// Before each model step, assemble a single explained block from the durable
// knowledge stores instead of leaving recall to scattered injections:
//
//   claims    (L3)  active claims from golden-land-memory-ledger: not
//                   superseded by any newer claim, trust >= minTrust, inside
//                   their validity window; ranked by trust;
//   resources (L4)  OpenViking semantic matches for the current prompt.
//
// Graphiti graph matches stay in graphiti/lifecycle.mjs — that plugin owns the
// temporal search and its provenance journaling; its reminder follows this one.
//
// Every line carries its record id so the model can expand provenance with
// `memory_trace` / `viking_read`. The pack is skipped entirely when both
// sources come back empty: no knowledge, no noise.
// ============================================================================
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Ledger, activeOpinions } from '../memory/ledger.mjs';
import { checkBinding } from '../memory/freshness.mjs';
import { readHot, agentId as hotAgentId, HOT_FILES } from '../memory/hot.mjs';
import { matchingCandidates } from '../memory/skills.mjs';
import { readableScopes, filterReadable } from '../memory/scopes.mjs';

const execFileP = promisify(execFile);

export const name = 'golden-land-context-pack';
export const inject = [];

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function resolveConfig(raw) {
  const src = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const num = (value, fallback, min, max) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
  };
  return {
    minTrust: num(src.minTrust, 0.6, 0, 1),
    boardId: typeof src.boardId === 'string' && src.boardId.trim() ? src.boardId.trim() : null,
    maxClaims: Math.round(num(src.maxClaims, 5, 0, 20)),
    maxResources: Math.round(num(src.maxResources, 3, 0, 10)),
    resourceAbstractChars: Math.round(num(src.resourceAbstractChars, 200, 40, 1000)),
    maxChars: Math.round(num(src.maxChars, 2400, 200, 20000)),
    openvikingBin: typeof src.openvikingBin === 'string' && src.openvikingBin.trim()
      ? src.openvikingBin
      : `${ROOT}runtime/openviking/.venv/bin/openviking`,
    openvikingConfig: typeof src.openvikingConfig === 'string' && src.openvikingConfig.trim()
      ? src.openvikingConfig
      : `${ROOT}runtime/openviking/ovcli.conf`,
  };
}

function promptOf(decision) {
  const prompts = (decision?.messages ?? [])
    .filter(m => m.role === 'user' && m.source?.kind !== 'plugin')
    .map(m => Array.isArray(m.content)
      ? m.content.filter(b => b.type === 'text').map(b => b.text).join(' ')
      : '')
    .filter(t => t.trim().length > 0);
  return (prompts.at(-1) ?? '').slice(0, 400);
}

/** Claims that are current knowledge: not superseded, trusted, in validity window. */
function activeClaims(records, cfg) {
  const superseded = new Set();
  for (const r of records) {
    if (r.type === 'claim') for (const id of r.supersedes ?? []) superseded.add(id);
  }
  const now = new Date();
  const inWindow = r => {
    const from = r.valid_from ? new Date(r.valid_from) : null;
    const until = r.valid_until ? new Date(r.valid_until) : null;
    if (from && Number.isNaN(from.valueOf())) return true;
    if (until && Number.isNaN(until.valueOf())) return true;
    if (from && now < from) return false;
    if (until && now > until) return false;
    return true;
  };
  return records
    .filter(r => r.type === 'claim'
      && r.kind !== 'opinion' // opinions surface in their own binding block
      && !superseded.has(r.id)
      && Number(r.trust) >= cfg.minTrust
      && inWindow(r))
    .sort((a, b) => Number(b.trust) - Number(a.trust))
    .slice(0, cfg.maxClaims);
}

/** Semantic resource matches via the OpenViking CLI; empty array on any failure. */
async function vikingResources(query, cfg) {
  if (!query.trim() || cfg.maxResources === 0) return [];
  try {
    const { stdout } = await execFileP(
      cfg.openvikingBin,
      ['find', query, '-n', String(cfg.maxResources * 3), '-o', 'json'],
      { timeout: 8000, env: { ...process.env, OPENVIKING_CLI_CONFIG_FILE: cfg.openvikingConfig } },
    );
    const start = stdout.indexOf('{');
    if (start < 0) return [];
    const payload = JSON.parse(stdout.slice(start));
    return (payload?.result?.resources ?? [])
      .sort((a, b) => Number(b.score) - Number(a.score))
      .slice(0, cfg.maxResources)
      .map(r => ({ uri: r.uri, score: Number(r.score), abstract: String(r.abstract ?? '') }));
  } catch {
    return []; // pack degrades to ledger-only; lifecycle recall still runs
  }
}

/** Freshness of one claim: walk its capsule inputs down to segment source bindings. */
async function claimFreshness(ledger, claim) {
  const segmentIds = new Set();
  for (const cid of claim.capsule_ids ?? []) {
    const capsule = await ledger.byId(cid);
    for (const i of capsule?.inputs ?? []) segmentIds.add(i.id);
  }
  const checks = [];
  for (const sid of segmentIds) {
    const seg = await ledger.byId(sid);
    if (!seg?.source_binding) continue;
    checks.push(await checkBinding(seg.source_binding));
  }
  if (checks.length === 0) return 'unbound';
  return checks.some(c => c.status === 'stale' || c.status === 'missing') ? 'stale' : 'fresh';
}

/** Subject tokens (≥4 chars) from the prompt for opinion matching. */
function queryTokens(query) {
  return new Set(String(query).toLowerCase().split(/[^^\p{L}\p{N}]+/u).filter(t => t.length >= 4));
}

/** Active user-directive opinions whose subject is mentioned in the prompt. */
function relevantOpinions(records, query) {
  const tokens = queryTokens(query);
  if (tokens.size === 0) return [];
  return activeOpinions(records).filter(o => {
    const subject = String(o.subject ?? '').toLowerCase();
    for (const t of tokens) {
      if (subject.includes(t) || t.includes(subject.split('/').pop() ?? '')) return true;
    }
    return false;
  });
}

export function apply(ctx, rawConfig) {
  const cfg = resolveConfig(rawConfig);
  const ledger = new Ledger();
  let degraded = false;
  ctx.logger?.info?.(`${name}: claims>=${cfg.minTrust} top${cfg.maxClaims}, viking top${cfg.maxResources}`);

  ctx.on('agent/pre-step', async ({ signal }, next) => {
    const decision = await next();
    try {
      if (decision?.kind !== 'enter' || signal.aborted) return decision;
      const query = promptOf(decision);
      if (!query.trim()) return decision;

      // Project assignment (memory/projects.mjs) overrides the env board id:
      // an assigned session reads and writes its project's scope.
      if (!cfg.boardId && ctx.session?.id) {
        try {
          const { readFile } = await import('node:fs/promises');
          const store = JSON.parse(await readFile(`${ROOT}runtime/projects.json`, 'utf8'));
          const assigned = store.assignments?.[ctx.session.id]?.projectId;
          if (assigned) cfg.boardId = assigned;
        } catch { /* no registry yet */ }
      }

      const records = await ledger.load().catch(() => []);
      // Scope resolution: this chat reads platform + its project + its own
      // private scope. Records from other boards and other agents' privates
      // stay invisible; the count feeds the coverage statement below.
      const scopes = readableScopes({ boardId: cfg.boardId, agentId: hotAgentId(cfg) });
      const totalRecords = records.filter(r => r.type === 'claim').length;
      const scopedRecords = filterReadable(records, scopes);
      const scopeExcluded = totalRecords - scopedRecords.filter(r => r.type === 'claim').length;
      const allClaims = scopedRecords.filter(r => r.type === 'claim' && r.kind !== 'opinion');
      const claims = activeClaims(records, cfg);
      const resources = await vikingResources(query, cfg);
      const opinions = relevantOpinions(records, query);
      if (claims.length === 0 && resources.length === 0 && opinions.length === 0) return decision;

      // Freshness invariant: derived layers must be younger than the latest
      // edits to their sources. Stale claims stay visible (supersession is the
      // only correct fix) but carry an explicit warning marker.
      const freshness = new Map();
      for (const c of claims) freshness.set(c.id, await claimFreshness(ledger, c));
      const staleCount = [...freshness.values()].filter(s => s === 'stale').length;

      const lines = [];

      // Hot memory layer: the agent's curated MEMORY.md/USER.md, always on top.
      const hotAgent = hotAgentId(cfg);
      const hotMemoryBody = (await readHot(hotAgent, 'memory')).trim();
      const hotUserBody = (await readHot(hotAgent, 'user')).trim();
      if (hotMemoryBody || hotUserBody) {
        lines.push(`Hot memory (${HOT_FILES.memory} / ${HOT_FILES.user} of agent "${hotAgent}", full file via memory_hot_read):`);
        if (hotMemoryBody) lines.push(hotMemoryBody.slice(0, 800));
        if (hotUserBody) lines.push(hotUserBody.slice(0, 800));
      }

      // Skill candidates: methods already proven once — recall, don't re-research.
      const candidates = await matchingCandidates(queryTokens(query)).catch(() => []);
      if (candidates.length > 0) {
        lines.push('Known skill candidates for this task type (proven methods; expand via the candidate SKILL.md):');
        for (const c of candidates) {
          const S = c.successes ?? c.uses ?? 0;
          const F = c.failures ?? 0;
          lines.push(`- [candidate:${c.slug}] ${c.name} — task_type=${c.task_type}, S=${S} F=${F} (record outcomes via memory_skill_use), evidence=${(c.evidence ?? []).join(',')}`);
        }
      }
      if (opinions.length > 0) {
        // User directives outrank everything: they are recorded truth about
        // how the user judges a subject, per aspect, last-wins.
        lines.push('User directives (opinion claims, last stated wins per subject×aspect):');
        for (const o of opinions) {
          lines.push(`- [claim:${o.id}] ${o.subject} × ${o.aspect} = ${o.verdict} — ${o.statement} (scope=${o.scope ?? 'platform/golden-land'})`);
        }
        lines.push('These are direct user judgements; treat them as binding context.');
      }
      if (claims.length > 0) {
        lines.push('Durable claims (memory ledger, current knowledge):');
        for (const c of claims) {
          const mark = freshness.get(c.id) === 'stale' ? ' ⚠STALE(source changed after derivation)' : '';
          const why = `picked-by: trust ${Number(c.trust).toFixed(2)} ≥ ${cfg.minTrust}, top-${cfg.maxClaims} by trust`;
          lines.push(`- [claim:${c.id}] trust=${Number(c.trust).toFixed(2)} scope=${c.scope ?? 'platform/golden-land'}${c.unbacked ? ' (unbacked)' : ''}${c.valid_until ? ` valid-until=${String(c.valid_until).slice(0, 10)}` : ''}${mark} why={${why}} ${c.statement}`);
        }
        if (staleCount > 0) {
          lines.push(`⚠ ${staleCount} claim(s) reference sources modified after derivation — verify against the source or re-derive via memory_segment → memory_compile → memory_claim supersedes.`);
        }
        lines.push('Expand any claim with memory_trace <id>; check a source with memory_freshness <id>; replace knowledge via supersedes, never silently.');
      }
      if (resources.length > 0) {
        lines.push('OpenViking semantic matches for this task:');
        for (const r of resources) {
          lines.push(`- [score=${r.score.toFixed(2)} why=picked-by: semantic match] ${r.uri}\n  ${r.abstract.slice(0, cfg.resourceAbstractChars)}`);
        }
        lines.push('Read a full source with viking_read <uri>.');
      }

      // Coverage statement: what this pack deliberately does NOT include.
      const supersededIds = new Set(allClaims.flatMap(c => c.supersedes ?? []));
      const eligible = allClaims.filter(c => !supersededIds.has(c.id));
      const belowTrust = eligible.filter(c => Number(c.trust) < cfg.minTrust).length;
      const beyondBudget = Math.max(0, eligible.filter(c => Number(c.trust) >= cfg.minTrust).length - claims.length);
      const uncovered = [
        `${belowTrust} claim(s) below trust ${cfg.minTrust}`,
        `${beyondBudget} top-trust claim(s) beyond maxClaims budget`,
        `${allClaims.length - eligible.length} superseded claim(s) excluded by design (visible via memory_trace)`,
      ];
      if (scopeExcluded > 0) uncovered.push(`${scopeExcluded} claim(s) outside this chat's scopes (${scopes.join(', ')})`);
      lines.push(`Not covered: ${uncovered.join('; ')}. Raise minTrust/maxClaims in plugin config or query memory_ledger_query for more.`);

      let body = lines.join('\n');
      if (body.length > cfg.maxChars) body = `${body.slice(0, cfg.maxChars)}\n…(pack truncated at budget)`;
      // Persisted user/messages must carry a stable message id (session
      // invariant on resume); DSH core does not assign ids to plugin-injected
      // messages, so generate one here.
      const pack = {
        kind: 'enter',
        messages: [...decision.messages, {
          role: 'user',
          id: randomUUID(),
          content: [{
            type: 'text',
            text: `<system-reminder>Golden Land durable memory for the current user request. Apply relevant user directives and current claims before acting. Treat stale, unbacked, low-trust, or semantic resource matches as leads that require source verification; current inspected state overrides memory. Expand provenance when a remembered fact affects a decision. Do not narrate routine memory use to the user. Graphiti temporal matches follow separately.\n${body}\n</system-reminder>`,
          }],
          source: { kind: 'plugin', plugin: name, form: 'context-pack' },
        }],
      };
      ctx.logger?.debug?.(`${name}: injected ${claims.length} claims, ${resources.length} resources`);
      return pack;
    } catch (error) {
      if (!degraded) {
        degraded = true;
        ctx.logger?.warn?.(`${name}: degraded: ${String(error?.message ?? error)}`);
      }
      return decision;
    }
  });
}
