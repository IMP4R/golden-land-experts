// ============================================================================
// Clone store guard — the isolated witches profile must never write live memory.
// ============================================================================
// Why this exists rather than editing memory/*.mjs: those modules are shared
// with the live profile, so a clone-specific edit there would change live
// behaviour. This plugin is mounted ONLY by the witches test profile.
//
// Two independent failures it closes:
//
//  1. Silent path fallback. Every Golden Land store resolves its location as
//     `process.env.GOLDEN_LAND_X || <live default>`, so a clone launched
//     without those variables writes into live memory with no signal at all.
//     Here an unset or out-of-clone path is an error at load.
//
//  2. Shared OpenViking writers. The clone reads the same server as live, and
//     the OpenViking plugin exposes `viking_remember` / `viking_ingest_local` /
//     `viking_add_resource` / `viking_forget`. Those are denied per agent in
//     the scoped context, because `ctx.tools.restrict` is agent-scoped by
//     contract and refuses to run from a plain context.
//
// Mirrors the per-store defaults in /Users/user0/golden-land-new/memory/*.mjs
// and the OpenViking writer names in /Users/user0/openviking-dsh-plugin/tools.mjs.
// ============================================================================

export const name = 'golden-land-clone-store-guard'
export const inject = ['tools']

/** Store variables the clone must set explicitly, with the live default each one falls back to. */
const REQUIRED_STORES = [
  { env: 'GOLDEN_LAND_LEDGER_PATH', liveDefault: 'runtime/memory-ledger/ledger.jsonl' },
  { env: 'GOLDEN_LAND_HOT_DIR', liveDefault: 'runtime/memory-hot' },
  { env: 'GOLDEN_LAND_SKILL_CANDIDATES_DIR', liveDefault: 'runtime/skill-candidates' },
  { env: 'GOLDEN_LAND_USAGE_LEDGER_PATH', liveDefault: 'runtime/usage-ledger.jsonl' },
  { env: 'GOLDEN_LAND_PROJECTS_PATH', liveDefault: 'runtime/projects.json' },
  { env: 'GOLDEN_LAND_SOURCES_DIR', liveDefault: 'runtime/memory-ledger/sources' },
]

/**
 * OpenViking tools that create state on the shared server. The clone reads the
 * same `:1933` instance as live, so these are refused rather than merely
 * discouraged: an unguarded `viking_remember` from the clone writes into the
 * live user's memory namespace.
 */
export const OPENVIKING_WRITE_TOOLS = [
  'viking_remember',
  'viking_ingest_local',
  'viking_add_resource',
  'viking_forget',
]

/**
 * Validate the isolated profile's store configuration.
 * @param env - process environment.
 * @param home - the clone DSH_HOME that every resolved path must sit under.
 * @returns the resolved store paths, keyed by variable name.
 * @throws when the guard is mounted outside the isolated profile, when a store
 *   variable is unset, or when a resolved path escapes the clone DSH_HOME.
 */
export function checkCloneStores(env, home) {
  if (env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') {
    throw new Error(
      'clone-store-guard: mounted outside the isolated witches profile; '
      + 'set GOLDEN_LAND_WITCHES_ISOLATED=1 or unmount golden-land-clone-store-guard',
    )
  }
  if (typeof home !== 'string' || home.length === 0) {
    throw new Error('clone-store-guard: DSH_HOME is required to bound the clone stores')
  }

  const resolved = {}
  const missing = []
  const escaped = []

  for (const store of REQUIRED_STORES) {
    const value = env[store.env]
    if (typeof value !== 'string' || value.trim().length === 0) {
      missing.push(`${store.env} (would fall back to live ${store.liveDefault})`)
      continue
    }
    const path = value.trim()
    resolved[store.env] = path
    if (path !== home && !path.startsWith(`${home}/`)) escaped.push(`${store.env}=${path}`)
  }

  if (missing.length > 0) {
    throw new Error(
      `clone-store-guard: refusing to start with unset store paths — ${missing.join('; ')}. `
      + 'An unset variable silently writes live memory; set it to a path under the clone DSH_HOME.',
    )
  }
  if (escaped.length > 0) {
    throw new Error(
      `clone-store-guard: refusing to start with store paths outside DSH_HOME (${home}) — ${escaped.join('; ')}`,
    )
  }

  return resolved
}

export function apply(ctx) {
  const home = process.env.DSH_HOME || ''
  const resolved = checkCloneStores(process.env, home)

  // A tool restriction may only be declared in the owning agent's scoped
  // context, so the deny is applied through `agent.ctx` — the same pattern the
  // subagent composition uses for a child's toolFilter. Registering it on the
  // plugin context instead would mask every agent, and reading `this.tools`
  // from a scoped listener is undefined at call time.
  ctx.on('agent/created', ({ agent }) => {
    const scoped = agent?.ctx
    if (!scoped || typeof scoped.tools?.restrict !== 'function') {
      ctx.logger?.warn?.(
        `${name}: agent ${String(agent?.id)} has no scoped tools service; `
        + 'OpenViking writers were not denied for it',
      )
      return
    }
    const known = new Set(ctx.tools.schemas().map(tool => tool.name))
    const registeredWriters = OPENVIKING_WRITE_TOOLS.filter(tool => known.has(tool))
    if (registeredWriters.length > 0) scoped.tools.restrict({ deny: registeredWriters })
  })

  // Defense in depth on the real executor path. Unlike schema restriction,
  // this global monotonic guard also denies forced or unscoped direct calls
  // before tools/execute can reach an OpenViking handler.
  ctx.effect(() => ctx.tools.guard((exec) => (
    OPENVIKING_WRITE_TOOLS.includes(exec.name)
      ? 'OpenViking writers are disabled in the isolated witches clone'
      : undefined
  )))

  ctx.logger?.info?.(
    `golden-land-clone-store-guard: ${Object.keys(resolved).length} stores bounded to ${home}; `
    + `OpenViking writers denied per agent: ${OPENVIKING_WRITE_TOOLS.join(', ')}`,
  )
}
