/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-reasoning-effort`.
 * @module @deepseek-ai/dsh-client-ui-reasoning-effort/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-reasoning-effort'

/** Cordis companion plugin name. */
export const name = 'client-ui-reasoning-effort-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: a single slot contribution whose lifecycle is
 * proven by the slot registry's own subscription/dispose semantics.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
