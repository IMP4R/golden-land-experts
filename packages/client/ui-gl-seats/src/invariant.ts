/** Package-owned invariant companion for Golden Land UI seats. */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-gl-seats'

/** Cordis companion plugin name. */
export const name = 'client-ui-gl-seats-invariant'
/** Service required before reserving package ownership. */
export const inject = ['invariants']

/** The package retains no host-side mutable state. */
const install: InvariantInstaller = () => {}

/** Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
