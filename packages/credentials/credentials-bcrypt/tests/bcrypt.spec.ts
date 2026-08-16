import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { MemoryCredentials } from '../../credentials/tests/memory.ts'
import {
  BcryptCredentialSeal,
  DEFAULT_SPEC,
  isBcryptDigest,
  resolveSpec,
} from '../src/index.ts'
import type { Config, ResolvedSpec } from '../src/index.ts'

const KEY = credentialRef('DSH_CRED_TEST')
const OTHER = credentialRef('DSH_CRED_OTHER')
/** The pin reference for `KEY` under the default suffix. */
const KEY_PIN = credentialRef('DSH_CRED_TEST_BCRYPT')

const cleanups: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  while (cleanups.length > 0) await cleanups.pop()!()
})

/**
 * Boot one sealing service over the in-memory provider. Hashing runs at the
 * cheapest legal cost so the suite stays fast; the cost bound itself is a
 * pure `resolveSpec` fact covered below.
 */
async function boot(
  config: Config = {},
  seed: Record<string, string> = {},
): Promise<Context> {
  const ctx = new Context()
  const memory = ctx.plugin(MemoryCredentials, seed)
  const seal = ctx.plugin(BcryptCredentialSeal, { cost: 4, ...config })
  cleanups.push(async () => {
    await seal.dispose()
  })
  cleanups.push(async () => {
    await memory.dispose()
  })
  await memory
  await seal
  return ctx
}

/** Let a `void`-fired update-time verification settle before asserting on it. */
const settle = (): Promise<void> => new Promise(resolvePause => setTimeout(resolvePause, 30))

describe('resolveSpec', () => {
  it('defaults to the shared default spec', () => {
    expect(resolveSpec({})).toEqual(DEFAULT_SPEC)
  })

  it('lets every field be overridden explicitly', () => {
    const spec = resolveSpec({ cost: 6, pinSuffix: '_HASH', verifyOnUpdate: false })
    expect(spec).toEqual({ cost: 6, pinSuffix: '_HASH', verifyOnUpdate: false } satisfies ResolvedSpec)
  })

  it('rejects an empty pin suffix, which would pin over the plaintext itself', () => {
    expect(() => resolveSpec({ pinSuffix: '' })).toThrow(RangeError)
    expect(() => resolveSpec({ pinSuffix: '-bad' })).toThrow(/_A-Za-z0-9/)
  })

  it('enforces the same suffix bound at schema normalization', () => {
    expect(() => BcryptCredentialSeal.Config({ pinSuffix: '' })).toThrow()
  })
})

describe('digest primitives', () => {
  it('recognizes modular-crypt bcrypt digests and nothing else', () => {
    expect(isBcryptDigest('$2b$10$K7L1OJ45j4tFqZJt9Yq0YeqVzq5Cn3r6wYwR7q5xqW8qMzqH0Q9Vi')).toBe(true)
    expect(isBcryptDigest('$2a$10$K7L1OJ45j4tFqZJt9Yq0YeqVzq5Cn3r6wYwR7q5xqW8qMzqH0Q9Vi')).toBe(true)
    expect(isBcryptDigest('$2y$12$K7L1OJ45j4tFqZJt9Yq0YeqVzq5Cn3r6wYwR7q5xqW8qMzqH0Q9Vi')).toBe(true)
    expect(isBcryptDigest('sk-live-plaintext')).toBe(false)
    expect(isBcryptDigest('2b$10$truncated')).toBe(false)
  })

  it('hashes a non-empty key into a bcrypt digest and never the plaintext', async () => {
    const ctx = await boot()
    const digest = await ctx.bcryptCredentials.hashApiKey('sk-plain')
    expect(digest).toMatch(/^\$2[aby]\$04\$/)
    expect(digest).toHaveLength(60)
    expect(digest).not.toContain('sk-plain')
  })

  it('refuses to hash an empty value, because empty is absent on this seam', async () => {
    const ctx = await boot()
    await expect(ctx.bcryptCredentials.hashApiKey('')).rejects.toThrow(/empty value cannot be hashed/)
  })

  it('verifies a plaintext against its digest and no other', async () => {
    const ctx = await boot()
    const digest = await ctx.bcryptCredentials.hashApiKey('sk-plain')
    await expect(ctx.bcryptCredentials.verifyApiKey('sk-plain', digest)).resolves.toBe(true)
    await expect(ctx.bcryptCredentials.verifyApiKey('sk-other', digest)).resolves.toBe(false)
  })

  it('refuses to compare against a value that is not a bcrypt digest', async () => {
    const ctx = await boot()
    await expect(ctx.bcryptCredentials.verifyApiKey('sk-plain', 'not-a-digest'))
      .rejects.toThrow(TypeError)
  })
})

describe('seal and unseal', () => {
  it('stores only the digest, under the derived pin reference', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    const stored = await ctx.credentials.resolve(KEY_PIN)
    expect(stored).toMatchObject({ source: 'memory' })
    expect(isBcryptDigest(stored!.value)).toBe(true)
    // The seal never wrote the plaintext anywhere new: the base reference
    // still resolves to the value the seam already held.
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'sk-live', source: 'memory' })
  })

  it('derives the pin reference from the configured suffix', async () => {
    const ctx = await boot({ pinSuffix: '_HASH' })
    expect(ctx.bcryptCredentials.sealRefFor(KEY)).toBe(credentialRef('DSH_CRED_TEST_HASH'))
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    expect(await ctx.credentials.resolve(credentialRef('DSH_CRED_TEST_HASH'))).toBeDefined()
    expect(await ctx.bcryptCredentials.pinnedDigest(KEY)).toBeDefined()
    await ctx.bcryptCredentials.unseal(KEY)
    expect(await ctx.bcryptCredentials.pinnedDigest(KEY)).toBeUndefined()
  })

  it('unseals by removing the pin and keeps unsealing an absent pin silent', async () => {
    const ctx = await boot()
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    await ctx.bcryptCredentials.unseal(KEY)
    await expect(ctx.bcryptCredentials.unseal(KEY)).resolves.toBeUndefined()
    expect(await ctx.credentials.resolve(KEY_PIN)).toBeUndefined()
  })

  it('reports a pinned digest through the pin reference only', async () => {
    const ctx = await boot()
    expect(await ctx.bcryptCredentials.pinnedDigest(KEY)).toBeUndefined()
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    const digest = await ctx.bcryptCredentials.pinnedDigest(KEY)
    expect(digest).toBeDefined()
    expect(isBcryptDigest(digest!)).toBe(true)
  })
})

describe('status', () => {
  it('reports an unpinned reference without verification facts', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    expect(await ctx.bcryptCredentials.status(KEY)).toEqual({ pinned: false })
  })

  it('reports pinned without verified while no plaintext resolves', async () => {
    const ctx = await boot()
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    expect(await ctx.bcryptCredentials.status(KEY)).toEqual({ pinned: true })
  })

  it('reports verified true or false from the live plaintext', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    expect(await ctx.bcryptCredentials.status(KEY)).toEqual({ pinned: true, verified: true })

    await ctx.credentials.set(KEY, 'sk-rotated')
    expect(await ctx.bcryptCredentials.status(KEY)).toEqual({ pinned: true, verified: false })
  })

  it('fails loud on a pin whose stored value is not a bcrypt digest', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.credentials.set(KEY_PIN, 'hand-corrupted')
    // The corrupt digest is rejected at the comparison boundary, once a
    // plaintext exists to compare.
    await expect(ctx.bcryptCredentials.status(KEY)).rejects.toThrow(TypeError)
    await expect(ctx.bcryptCredentials.assertVerified(KEY)).rejects.toThrow(TypeError)
  })
})

describe('assertVerified', () => {
  it('passes an unpinned reference — pinning is opt-in per key', async () => {
    const ctx = await boot()
    await expect(ctx.bcryptCredentials.assertVerified(KEY)).resolves.toBeUndefined()
  })

  it('passes a sealed reference whose live plaintext matches', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    await expect(ctx.bcryptCredentials.assertVerified(KEY)).resolves.toBeUndefined()
  })

  it('fails a sealed reference with no plaintext on the seam', async () => {
    const ctx = await boot()
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    await expect(ctx.bcryptCredentials.assertVerified(KEY)).rejects.toThrow(/no plaintext resolves/)
  })

  it('fails a sealed reference whose plaintext rotated away from the digest', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    await ctx.credentials.set(KEY, 'sk-rotated')
    await expect(ctx.bcryptCredentials.assertVerified(KEY)).rejects.toThrow(/does not match its sealed digest/)
  })
})

describe('update-time verification', () => {
  it('re-checks a committed plaintext change and logs a mismatch without failing the write', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    // Let the seal's own commit verification settle first, so the two error
    // records below are exactly the rotated plaintext's.
    await settle()
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    // The write itself committed; the mismatch is reported, not rethrown.
    await expect(ctx.credentials.set(KEY, 'sk-rotated')).resolves.toBeUndefined()
    await vi.waitFor(() => {
      expect(errors).toHaveBeenCalled()
    })
    expect(errors).toHaveBeenCalledTimes(2)
    expect(await ctx.credentials.resolve(KEY)).toEqual({ value: 'sk-rotated', source: 'memory' })
  })

  it('re-checks a committed pin change against the base reference', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    // Replacing the pin re-verifies the plaintext it pins, which still matches.
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    await settle()
    expect(errors).not.toHaveBeenCalled()

    // Removing the pin re-checks and finds nothing pinned: no error either.
    await ctx.bcryptCredentials.unseal(KEY)
    await settle()
    expect(errors).not.toHaveBeenCalled()
    expect(await ctx.bcryptCredentials.pinnedDigest(KEY)).toBeUndefined()
  })

  it('ignores updates to references with no pin and to the bare suffix', async () => {
    const ctx = await boot({}, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    await settle()
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    // An unrelated plaintext reference has no pin to check.
    await ctx.credentials.set(OTHER, 'sk-other')
    // A reference consisting of the suffix alone has an empty base and no pin.
    await ctx.credentials.set(credentialRef('_BCRYPT'), 'sk-odd-name')
    await settle()
    expect(errors).not.toHaveBeenCalled()
  })

  it('stops re-verifying once the seal service is disposed', async () => {
    const ctx = new Context()
    const memory = ctx.plugin(MemoryCredentials, { DSH_CRED_TEST: 'sk-live' })
    const seal = ctx.plugin(BcryptCredentialSeal, { cost: 4 })
    await memory
    await seal
    cleanups.push(async () => {
      await memory.dispose()
    })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})

    await seal.dispose()
    // The pin is still stored, but the listener went with the service: a
    // later plaintext change is nobody's business to re-check here.
    await ctx.credentials.set(KEY, 'sk-rotated')
    await settle()
    expect(errors).not.toHaveBeenCalled()
    expect(await ctx.credentials.resolve(KEY_PIN)).toBeDefined()
  })

  it('registers no listener at all when verifyOnUpdate is false', async () => {
    const ctx = await boot({ verifyOnUpdate: false }, { DSH_CRED_TEST: 'sk-live' })
    await ctx.bcryptCredentials.seal(KEY, 'sk-live')
    const errors = vi.spyOn(ctx.logger, 'error').mockImplementation(() => {})
    await ctx.credentials.set(KEY, 'sk-rotated')
    await settle()
    expect(errors).not.toHaveBeenCalled()
    expect(await ctx.bcryptCredentials.status(KEY)).toEqual({ pinned: true, verified: false })
  })
})
