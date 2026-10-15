/**
 * Isolated dual-route persistence used by the witches test profile.
 * Lives next to apiproxy so the release package does not depend on
 * experimental witches-runtime.
 * @module @deepseek-ai/dsh-host-apiproxy/witch-routes
 */

import { readFileSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export interface WitchRoutePair {
  provider: string
  model: string
}

export interface WitchRoutesFile {
  cheap: WitchRoutePair
  expensive: WitchRoutePair
  active: 'cheap' | 'expensive'
  revision: number
}

const DEFAULTS: WitchRoutesFile = {
  cheap: { provider: 'cheapvibecode', model: 'glm-5.3-flash' },
  expensive: { provider: 'cheapvibecode', model: 'gpt-6-astra' },
  active: 'cheap',
  revision: 0,
}

function filePath(): string {
  const home = process.env.DSH_HOME
  if (home === undefined || home.length === 0) {
    throw new Error('witch dual-route store requires DSH_HOME')
  }
  return join(home, 'storages', 'witch-routes.json')
}

function emptyAll(): Record<string, WitchRoutesFile> {
  return {}
}

function parseAll(raw: string): Record<string, WitchRoutesFile> {
  const parsed = JSON.parse(raw) as Record<string, WitchRoutesFile>
  return parsed && typeof parsed === 'object' ? parsed : emptyAll()
}

async function loadAll(): Promise<Record<string, WitchRoutesFile>> {
  try {
    return parseAll(await readFile(filePath(), 'utf8'))
  } catch {
    return emptyAll()
  }
}

function loadAllSync(): Record<string, WitchRoutesFile> {
  try {
    return parseAll(readFileSync(filePath(), 'utf8'))
  } catch {
    return emptyAll()
  }
}

function defaultRoutes(): WitchRoutesFile {
  return {
    cheap: { ...DEFAULTS.cheap },
    expensive: { ...DEFAULTS.expensive },
    active: DEFAULTS.active,
    revision: DEFAULTS.revision,
  }
}

function routesOf(all: Record<string, WitchRoutesFile>, sessionId: string): WitchRoutesFile {
  const stored = all[sessionId]
  if (stored === undefined) return defaultRoutes()
  return {
    cheap: { ...stored.cheap },
    expensive: { ...stored.expensive },
    active: stored.active,
    revision: Number.isSafeInteger(stored.revision) ? stored.revision : 0,
  }
}

/**
 * Read both executor slots and which one a composer selection currently edits.
 * Synchronous because the dialogue request boundary reads it mid-request.
 * @param sessionId - witch session.
 * @returns the slots, or undefined outside the isolated composition.
 */
export function isolatedRoutesSync(sessionId: string): WitchRoutesFile | undefined {
  if (process.env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') return undefined
  const current = routesOf(loadAllSync(), sessionId)
  return {
    cheap: { ...current.cheap },
    expensive: { ...current.expensive },
    active: current.active,
    revision: current.revision,
  }
}

/**
 * Persist a selection onto one named executor slot without moving the active
 * slot. Silent by construction: it writes no session event.
 * @param sessionId - witch session.
 * @param kind - slot to write.
 * @param selected - picker result.
 */
export async function applyIsolatedSlot(
  sessionId: string,
  kind: 'cheap' | 'expensive',
  selected: WitchRoutePair,
): Promise<WitchRoutesFile | undefined> {
  if (process.env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') return undefined
  const all = await loadAll()
  const current = routesOf(all, sessionId)
  const next: WitchRoutesFile = {
    ...current,
    [kind]: { provider: selected.provider, model: selected.model },
    revision: current.revision + 1,
  }
  all[sessionId] = next
  const file = filePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  return next
}

/**
 * Persist a composer picker selection onto the session's currently active
 * cheap/expensive slot. No-op when isolation is not enabled.
 * @param sessionId - witch session.
 * @param selected - picker result.
 */
export async function applyIsolatedPicker(
  sessionId: string,
  selected: WitchRoutePair,
): Promise<WitchRoutesFile | undefined> {
  const current = isolatedRoutesSync(sessionId)
  return current === undefined
    ? undefined
    : applyIsolatedSlot(sessionId, current.active, selected)
}

/**
 * Read the route the isolated witch should assemble.
 * @param sessionId - witch session.
 */
export async function isolatedAssembledRoute(
  sessionId: string,
): Promise<WitchRoutePair | undefined> {
  if (process.env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') return undefined
  const current = routesOf(await loadAll(), sessionId)
  return { ...current[current.active] }
}

/**
 * Synchronous assembled route for the live picker getter.
 * @param sessionId - witch session.
 */
export function isolatedAssembledRouteSync(sessionId: string): WitchRoutePair | undefined {
  if (process.env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') return undefined
  const current = routesOf(loadAllSync(), sessionId)
  return { ...current[current.active] }
}

/**
 * Cheap route for children, experts, and Memory Broker.
 * Isolation-only; undefined outside the witches test profile.
 * @param sessionId - witch session, or empty for deployment defaults.
 */
export function isolatedCheapRouteSync(sessionId = ''): WitchRoutePair | undefined {
  if (process.env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') return undefined
  if (sessionId.length === 0) return { ...DEFAULTS.cheap }
  const current = routesOf(loadAllSync(), sessionId)
  return { ...current.cheap }
}

/**
 * Dialogue route, independent of the executor slot being edited.
 * @param sessionId - human-facing witch session.
 * @returns the cheap route, or undefined outside the isolated composition.
 */
export function isolatedDialogueRouteSync(sessionId: string): WitchRoutePair | undefined {
  return isolatedCheapRouteSync(sessionId)
}

/**
 * Switch the executor-model slot edited by the isolated witch's picker.
 * @param sessionId - witch session.
 * @param kind - requested slot.
 */
export async function switchIsolatedKind(
  sessionId: string,
  kind: 'cheap' | 'expensive',
): Promise<WitchRoutesFile | undefined> {
  if (process.env.GOLDEN_LAND_WITCHES_ISOLATED !== '1') return undefined
  const all = await loadAll()
  const current = routesOf(all, sessionId)
  const next: WitchRoutesFile = { ...current, active: kind, revision: current.revision + 1 }
  all[sessionId] = next
  const file = filePath()
  await mkdir(dirname(file), { recursive: true })
  await writeFile(file, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
  return next
}
