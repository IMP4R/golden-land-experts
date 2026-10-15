/**
 * Package-owned invariant companion for witches-runtime.
 * Capsule injection is reconstructed from plugin-attributed user messages;
 * dual-route settings are validated by schemastery before the service observes them.
 * @module @deepseek-ai/dsh-experimental-witches-runtime/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-experimental-witches-runtime'

/** Cordis companion plugin name. */
export const name = 'witches-runtime-invariant'
/** Service required before the companion can register. */
export const inject = ['invariants']

/** No runtime invariant: settings and broker packing own the mutable-value checks. */
const install: InvariantInstaller = () => {}

/**
 * Register the intentionally empty invariant contribution.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
