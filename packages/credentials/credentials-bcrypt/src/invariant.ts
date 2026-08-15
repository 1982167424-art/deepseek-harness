/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-credentials-bcrypt`.
 * @module @deepseek-ai/dsh-credentials-bcrypt/invariant
 */

import type { Context } from '@deepseek-ai/cordis'
import type { InvariantFailure, InvariantInstaller } from '@deepseek-ai/dsh-invariants'
import { DEFAULT_SPEC } from './index.ts'

const PACKAGE_NAME = '@deepseek-ai/dsh-credentials-bcrypt'

/** Cordis companion plugin name. */
export const name = 'credentials-bcrypt-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * Install the lifecycle contract: `credentials/updated` for a default-suffix
 * pin reference can only fire while the sealing service is live — an emission
 * after disposal means a seal or unseal leaked work past teardown. A
 * deployment overriding `pinSuffix` owns its pins' lifecycle itself: the
 * companion cannot learn the configured suffix while the service is absent,
 * which is exactly the case it checks. The value relation (digest matching
 * the live plaintext) is asynchronous provider I/O and stays pinned by this
 * package's own suite.
 */
const install: InvariantInstaller = (ctx: Context, fail: InvariantFailure) => {
  ctx.on('credentials/updated', (ref) => {
    if (ctx.get('bcryptCredentials') === undefined && ctx.get('credentials') !== undefined) {
      // Only pin references belong to this package; a plaintext reference's
      // updates are the base seam's business and happen without it.
      if (ref.endsWith(DEFAULT_SPEC.pinSuffix)) {
        fail(`credentials/updated for pin "${ref}" emitted without a live bcryptCredentials service`)
      }
    }
  })
}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
