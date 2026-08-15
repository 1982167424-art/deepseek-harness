/**
 * bcrypt sealing for API keys added to the harness (`ctx.bcryptCredentials`).
 *
 * bcrypt is a one-way hash, so a sealed key cannot be re-derived from storage.
 * The seal therefore does not replace the plaintext channel — it pins it: the
 * credentials document stores only the bcrypt digest under a derived
 * reference (`SILICONFLOW_API_KEY` → `SILICONFLOW_API_KEY_BCRYPT`), while the
 * plaintext keeps arriving per operation through the regular credential seam
 * layers (inherited environment, `.credentials.yaml`, `.env`). Every check
 * re-resolves the plaintext and compares it against the digest, so the
 * at-rest document may be shared, backed up, or shown in a configuration UI
 * without exposing any usable secret, and a rotated or mistyped environment
 * key is caught as a loud mismatch instead of an opaque upstream `401`.
 *
 * Sealing is per reference and explicit: `seal` computes the digest, `unseal`
 * removes the pin, `status` reports it, and `assertVerified` fails loud on a
 * mismatch. With `verifyOnUpdate` (default on), a committed change to either
 * the plaintext or the digest re-runs the comparison and logs a mismatch as
 * an error — the write itself already committed, so a broken observer must
 * not make it look failed.
 * @module @deepseek-ai/dsh-credentials-bcrypt
 */

import { Context, Service } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { compare, hash } from 'bcryptjs'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialRef, ResolvedCredential } from '@deepseek-ai/dsh-credentials'

/** Plugin config: digest cost, derived-reference suffix, and update-time verification. */
export interface Config {
  /** bcrypt cost factor; defaults to 10. Higher costs slow every seal and check. */
  cost?: number
  /** Suffix turning a reference into its pin reference; defaults to `_BCRYPT`. */
  pinSuffix?: string
  /** Re-verify a pinned reference when its plaintext or digest commits a change; defaults to true. */
  verifyOnUpdate?: boolean
}

/** Fully resolved plugin parameters; defaulting happens here, never inline. */
export interface ResolvedSpec {
  cost: number
  pinSuffix: string
  verifyOnUpdate: boolean
}

/**
 * The one source of the plugin defaults, shared by the Schemastery schema,
 * {@link resolveSpec}, and the invariant companion's default-suffix guard.
 */
export const DEFAULT_SPEC: Readonly<ResolvedSpec> = Object.freeze({
  cost: 10,
  pinSuffix: '_BCRYPT',
  verifyOnUpdate: true,
})

/**
 * Every acceptable `pinSuffix`: non-empty and POSIX-identifier characters
 * only, so `ref + pinSuffix` always remains a valid credential reference and
 * a seal can never overwrite the plaintext reference it pins.
 */
const PIN_SUFFIX_PATTERN = /^[_A-Za-z0-9]+$/

/**
 * Resolve the runtime spec from plugin config. Programmatic construction may
 * bypass Schemastery normalization, so the suffix bound is re-proven here.
 * @param config - raw plugin config.
 * @returns the digest cost, pin suffix, and update-time verification flag.
 * @throws RangeError when `pinSuffix` is empty or carries non-identifier characters.
 */
export function resolveSpec(config: Config): ResolvedSpec {
  const pinSuffix = config.pinSuffix ?? DEFAULT_SPEC.pinSuffix
  if (!PIN_SUFFIX_PATTERN.test(pinSuffix)) {
    throw new RangeError(
      `bcrypt-credentials: pinSuffix ${JSON.stringify(pinSuffix)} must be non-empty and contain only`
      + ' [_A-Za-z0-9] so every derived pin reference stays a valid credential reference',
    )
  }
  return {
    cost: config.cost ?? DEFAULT_SPEC.cost,
    pinSuffix,
    verifyOnUpdate: config.verifyOnUpdate ?? DEFAULT_SPEC.verifyOnUpdate,
  }
}

/** Pin state for one reference, safe for configuration UIs — never the digest or the plaintext. */
export interface SealStatus {
  /** Whether a bcrypt digest is stored for the reference. */
  pinned: boolean
  /**
   * Whether the currently resolved plaintext matches the digest; absent while
   * the reference is unpinned or no plaintext resolves.
   */
  verified?: boolean | undefined
}

/** Modular-crypt bcrypt digest prefix: `$2a$`, `$2b$`, or `$2y$` with a two-digit cost. */
const BCRYPT_PREFIX = /^\$2[aby]\$\d{2}\$/

/**
 * Whether a stored value is a bcrypt digest. A hand-written digest that does
 * not carry the prefix can never verify, so it is rejected at the boundary
 * instead of failing as a silent mismatch later.
 * @param value - the stored value to test.
 * @returns whether the value looks like a bcrypt digest.
 */
export function isBcryptDigest(value: string): boolean {
  return BCRYPT_PREFIX.test(value)
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    bcryptCredentials: BcryptCredentialSeal
  }
}

/** bcrypt sealing service over the credential-reference seam. */
export class BcryptCredentialSeal extends Service {
  static Config: z<Config> = z.object({
    cost: z.number().min(4).max(15).default(DEFAULT_SPEC.cost),
    pinSuffix: z.string().pattern(PIN_SUFFIX_PATTERN).default(DEFAULT_SPEC.pinSuffix),
    verifyOnUpdate: z.boolean().default(DEFAULT_SPEC.verifyOnUpdate),
  })

  static inject = ['credentials']

  private readonly spec: ResolvedSpec

  constructor(ctx: Context, public config: Config) {
    super(ctx, 'bcryptCredentials')
    this.spec = resolveSpec(config)
  }

  /**
   * The pin reference for a sealed reference.
   * @param ref - the reference whose plaintext is pinned.
   * @returns the derived reference holding the digest.
   */
  sealRefFor(ref: CredentialRef): CredentialRef {
    return credentialRef(`${ref}${this.spec.pinSuffix}`)
  }

  /**
   * Hash one API key into a bcrypt digest at the configured cost.
   * @param value - the plaintext key; empty is rejected because the seam treats empty as absent.
   * @returns the bcrypt digest (`$2b$…`).
   */
  async hashApiKey(value: string): Promise<string> {
    if (value.length === 0) {
      throw new Error('bcrypt-credentials: an empty value cannot be hashed; empty is absent everywhere on this seam')
    }
    return hash(value, this.spec.cost)
  }

  /**
   * Compare one plaintext against a stored digest.
   * @param value - the plaintext candidate.
   * @param digest - the stored digest; a non-bcrypt digest is rejected, not compared.
   * @returns whether the plaintext hashes to the digest.
   */
  async verifyApiKey(value: string, digest: string): Promise<boolean> {
    if (!isBcryptDigest(digest)) {
      throw new TypeError('bcrypt-credentials: the stored pin is not a bcrypt digest; re-seal the reference')
    }
    return compare(value, digest)
  }

  /**
   * Seal one reference: compute the digest and store it under the pin
   * reference. The plaintext itself is never stored by this service — it
   * keeps arriving per operation through the seam's own layers.
   * @param ref - the reference to pin, such as `SILICONFLOW_API_KEY`.
   * @param value - the plaintext key at sealing time.
   */
  async seal(ref: CredentialRef, value: string): Promise<void> {
    const digest = await this.hashApiKey(value)
    await this.ctx.credentials.set(this.sealRefFor(ref), digest)
  }

  /**
   * Remove the pin for one reference; removing an absent pin is a no-op.
   * @param ref - the reference to unpin.
   */
  async unseal(ref: CredentialRef): Promise<void> {
    await this.ctx.credentials.unset(this.sealRefFor(ref))
  }

  /**
   * The stored digest for one reference, or `undefined` while unpinned.
   * @param ref - the reference to inspect.
   * @returns the digest, safe to display.
   */
  async pinnedDigest(ref: CredentialRef): Promise<string | undefined> {
    const resolved: ResolvedCredential | undefined = await this.ctx.credentials.resolve(this.sealRefFor(ref))
    return resolved?.value
  }

  /**
   * Report the pin state of one reference without exposing any secret.
   * @param ref - the reference to inspect.
   * @returns whether a digest is stored, and whether the live plaintext matches it.
   */
  async status(ref: CredentialRef): Promise<SealStatus> {
    const digest = await this.pinnedDigest(ref)
    if (digest === undefined) return { pinned: false }
    const live = await this.ctx.credentials.resolve(ref)
    if (live === undefined) return { pinned: true }
    return { pinned: true, verified: await this.verifyApiKey(live.value, digest) }
  }

  /**
   * Fail loud when a pinned reference's live plaintext does not match its
   * digest. An unpinned reference passes — pinning is opt-in per key. Call
   * this before the first upstream use of a sealed key, where a mismatch
   * would otherwise surface as an opaque provider authentication failure.
   * @param ref - the reference to check.
   * @throws when the reference is sealed but no plaintext resolves, or the plaintext mismatches the digest.
   */
  async assertVerified(ref: CredentialRef): Promise<void> {
    const digest = await this.pinnedDigest(ref)
    if (digest === undefined) return
    const live = await this.ctx.credentials.resolve(ref)
    if (live === undefined) {
      throw new Error(
        `bcrypt-credentials: "${ref}" is sealed but no plaintext resolves on the credential seam;`
        + ' supply the key through the environment or the credentials document',
      )
    }
    if (!(await this.verifyApiKey(live.value, digest))) {
      throw new Error(
        `bcrypt-credentials: the plaintext for "${ref}" does not match its sealed digest;`
        + ' either restore the original key or re-seal with the new one',
      )
    }
  }

  async* [Service.init](): AsyncGenerator<() => Promise<void> | void, void, void> {
    if (!this.spec.verifyOnUpdate) return
    const dispose = this.ctx.on('credentials/updated', (ref) => {
      void this.reverifyAround(ref)
    })
    yield () => {
      dispose()
    }
  }

  /**
   * Update-time verification for one committed change: a plaintext change
   * re-checks its own pin, and a digest change re-checks the base reference.
   * Contained — the commit already happened, so a mismatch logs as an error
   * and nothing rethrows into the seam's listener fan-out.
   * @param ref - the reference that committed a change.
   */
  private async reverifyAround(ref: CredentialRef): Promise<void> {
    try {
      const base = ref.endsWith(this.spec.pinSuffix)
        ? ref.slice(0, -this.spec.pinSuffix.length)
        : ref
      if (base.length === 0) return
      if ((await this.pinnedDigest(credentialRef(base))) === undefined) return
      await this.assertVerified(credentialRef(base))
    } catch (error) {
      this.ctx.logger.error('bcrypt-credentials: verification after an update of "%s" failed', ref)
      this.ctx.logger.error(error)
    }
  }
}

export default BcryptCredentialSeal
