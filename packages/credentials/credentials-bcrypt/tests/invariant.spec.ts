import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import InvariantRegistry from '@deepseek-ai/dsh-invariants'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import * as BcryptInvariant from '../src/invariant.ts'
import { BcryptCredentialSeal } from '../src/index.ts'
import { MemoryCredentials } from '../../credentials/tests/memory.ts'

const REF = credentialRef('DEEPSEEK_API_KEY')
const PIN_REF = credentialRef('DEEPSEEK_API_KEY_BCRYPT')

describe('credentials-bcrypt invariant companion', () => {
  it('accepts a committed pin change emitted by a live service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BcryptInvariant)
    await ctx.plugin(MemoryCredentials)
    await ctx.plugin(BcryptCredentialSeal, { cost: 4 })

    await expect(ctx.bcryptCredentials.seal(REF, 'sk-live')).resolves.toBeUndefined()
  })

  it('fails a pin update emitted without a live sealing service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BcryptInvariant)
    await ctx.plugin(MemoryCredentials)

    expect(() => { ctx.emit('credentials/updated', PIN_REF) })
      .toThrow(/invariant violated by "@deepseek-ai\/dsh-credentials-bcrypt"/)
  })

  it('accepts a plaintext update without a live sealing service', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BcryptInvariant)
    await ctx.plugin(MemoryCredentials)

    expect(() => { ctx.emit('credentials/updated', REF) }).not.toThrow()
  })

  it('leaves updates to the base seam while no credentials service is live either', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BcryptInvariant)

    // The base credentials invariant owns that emission; this companion must
    // not double-report it.
    expect(() => { ctx.emit('credentials/updated', PIN_REF) }).not.toThrow()
  })

  it('reserves the package name against duplicate registration', async () => {
    const ctx = new Context()
    await ctx.plugin(InvariantRegistry)
    await ctx.plugin(BcryptInvariant)

    expect(() => {
      ctx.invariants.register('@deepseek-ai/dsh-credentials-bcrypt', () => {})
    }).toThrow(/already registered/)
  })
})
