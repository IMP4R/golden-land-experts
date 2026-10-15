/**
 * Dual cheap/expensive route resolution. Cheap failure never silently
 * promotes to expensive.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/routes
 */

import type { WitchModelRoutes, WitchRoute, WitchRouteKind } from './types.ts'

/** Resolve which stored route a witch should assemble. */
export function activeRoute(routes: WitchModelRoutes): WitchRoute {
  return routes[routes.active]
}

/**
 * Resolve a child or expert route.
 * Explicit override wins; otherwise the cheap route is used unless the
 * caller authorized expensive.
 * @param routes - stored dual routes.
 * @param kind - requested kind.
 * @param override - per-task override.
 */
export function resolveExecutionRoute(
  routes: WitchModelRoutes,
  kind: WitchRouteKind,
  override?: WitchRoute,
): WitchRoute {
  if (override !== undefined) return override
  return routes[kind]
}

/**
 * Record a picker selection onto the currently active dual-route slot.
 * @param routes - previous stored routes.
 * @param selected - picker result.
 */
export function applyPickerToActive(routes: WitchModelRoutes, selected: WitchRoute): WitchModelRoutes {
  return {
    ...routes,
    [routes.active]: selected,
  }
}

/**
 * Toggle the witch's own assembly kind without rewriting the other slot.
 * @param routes - previous stored routes.
 * @param active - requested kind.
 */
export function setActiveKind(routes: WitchModelRoutes, active: WitchRouteKind): WitchModelRoutes {
  return { ...routes, active }
}
