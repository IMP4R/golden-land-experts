/**
 * Durable per-session cheap/expensive routes.
 * Cheap failure never silently promotes to expensive.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/route-store
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { WitchModelRoutes, WitchRoute, WitchRouteKind } from './types.ts'
import { applyPickerToActive, setActiveKind } from './routes.ts'

/** Defaults used before a session stores its own pair. */
export interface RouteStoreDefaults {
  cheap: WitchRoute
  expensive: WitchRoute
}

/**
 * File-backed dual-route map keyed by session id.
 * Writes are serialized per process; last write wins per session.
 */
export class WitchRouteStore {
  private readonly file: string
  private readonly defaults: RouteStoreDefaults
  private cache: Record<string, WitchModelRoutes> | undefined
  private writeChain = Promise.resolve()

  constructor(root: string, defaults: RouteStoreDefaults) {
    this.file = join(root, 'witch-routes.json')
    this.defaults = defaults
  }

  /**
   * Read the dual routes for one witch session.
   * @param sessionId - live session id.
   */
  async get(sessionId: string): Promise<WitchModelRoutes> {
    const all = await this.load()
    const stored = all[sessionId]
    if (stored !== undefined) return cloneRoutes(stored)
    return {
      cheap: { ...this.defaults.cheap },
      expensive: { ...this.defaults.expensive },
      active: 'cheap',
    }
  }

  /**
   * Persist a complete dual-route record.
   * @param sessionId - live session id.
   * @param routes - next stored routes.
   */
  async set(sessionId: string, routes: WitchModelRoutes): Promise<WitchModelRoutes> {
    const next = cloneRoutes(routes)
    this.writeChain = this.writeChain.then(async () => {
      const all = await this.load()
      all[sessionId] = next
      await mkdir(dirname(this.file), { recursive: true })
      await writeFile(this.file, `${JSON.stringify(all, null, 2)}\n`, 'utf8')
      this.cache = all
    })
    await this.writeChain
    return cloneRoutes(next)
  }

  /**
   * Write a picker selection onto the currently active slot and return it.
   * @param sessionId - live session id.
   * @param selected - picker result.
   */
  async applyPicker(sessionId: string, selected: WitchRoute): Promise<WitchModelRoutes> {
    const current = await this.get(sessionId)
    return this.set(sessionId, applyPickerToActive(current, selected))
  }

  /**
   * Switch cheap/expensive and return the route the witch should assemble.
   * @param sessionId - live session id.
   * @param kind - requested kind.
   */
  async switchKind(sessionId: string, kind: WitchRouteKind): Promise<WitchModelRoutes> {
    const current = await this.get(sessionId)
    return this.set(sessionId, setActiveKind(current, kind))
  }

  private async load(): Promise<Record<string, WitchModelRoutes>> {
    if (this.cache !== undefined) return this.cache
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, WitchModelRoutes>
      this.cache = raw && typeof raw === 'object' ? raw : {}
    } catch {
      this.cache = {}
    }
    return this.cache
  }
}

/** Detach one dual-route record. */
function cloneRoutes(routes: WitchModelRoutes): WitchModelRoutes {
  return {
    cheap: { ...routes.cheap },
    expensive: { ...routes.expensive },
    active: routes.active,
  }
}
