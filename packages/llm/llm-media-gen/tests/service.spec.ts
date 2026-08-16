/**
 * Keyless contract tests for MediaGenService: provider ordering failures and
 * the DeepSeek-backed prompt-polish flow against a scripted llm stream.
 */

import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { LlmRuntime, StreamChunk } from '@deepseek-ai/dsh-llm'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { MediaGenService, type MediaGenSettings } from '../src/index.ts'

function settingsWith(overrides: Partial<MediaGenSettings>): MediaGenSettings {
  return {
    provider: 'auto',
    defaultImageSize: '1024x1024',
    defaultImageStyle: 'general',
    defaultVideoDuration: 5,
    wallpaperModerationEnabled: true,
    polish: { enabled: true, provider: 'deepseek', model: 'deepseek-v4-flash' },
    resolveProvider: async () => undefined,
    ...overrides,
  }
}

/** Scripted llm runtime whose stream replays fixed chunks. */
function fakeLlm(chunks: StreamChunk[]): LlmRuntime {
  return {
    stream: async function* (): AsyncIterable<StreamChunk> {
      for (const chunk of chunks) yield chunk
    },
  } as unknown as LlmRuntime
}

function textChunks(parts: string[]): StreamChunk[] {
  return [
    { type: 'block-start', index: 0, blockType: 'text' },
    ...parts.map((text): StreamChunk => ({ type: 'text-delta', index: 0, text })),
    {
      type: 'block-end',
      index: 0,
      block: { type: 'text', text: parts.join('') },
    },
    { type: 'finish', reason: { kind: 'stop' } },
  ]
}

describe('MediaGenService provider ordering', () => {
  it('fails with MISSING_CREDENTIAL and the env names when no provider is configured', async () => {
    const ctx = new Context()
    const service = new MediaGenService(ctx, () => settingsWith({}))
    await expect(service.generateImage({ prompt: 'dawn' }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL', message: expect.stringContaining('VOLCENGINE_API_KEY') })
    await expect(service.generateVideo({ prompt: 'dawn' }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
  })

  it('names the missing env var when a pinned provider has no credential', async () => {
    const ctx = new Context()
    const service = new MediaGenService(ctx, () => settingsWith({}))
    await expect(service.generateImage({ prompt: 'dawn', provider: 'dashscope' }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL', message: expect.stringContaining('DASHSCOPE_API_KEY') })
  })

  it('rejects a video request pinned to an image-only provider', async () => {
    const ctx = new Context()
    const service = new MediaGenService(ctx, () => settingsWith({}))
    await expect(service.generateVideo({ prompt: 'dawn', provider: 'zhipu' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST', message: expect.stringContaining('does not generate video') })
  })
})

describe('MediaGenService.polishPrompt', () => {
  it('returns the joined text with the configured route', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeLlm(textChunks(['黄昏海面', '，晚霞漫天'])))
    const service = new MediaGenService(ctx, () => settingsWith({}))
    const result = await service.polishPrompt({ idea: '海边的黄昏', target: 'image' })
    expect(result.polishedPrompt).toBe('黄昏海面，晚霞漫天')
    expect(result.provider).toBe('deepseek')
    expect(result.model).toBe('deepseek-v4-flash')
  })

  it('rejects an empty idea and a disabled polish config', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeLlm(textChunks(['x'])))
    const service = new MediaGenService(ctx, () => settingsWith({}))
    await expect(service.polishPrompt({ idea: '   ', target: 'image' }))
      .rejects.toBeInstanceOf(LlmError)
    const disabledCtx = new Context()
    disabledCtx.provide('llm', fakeLlm(textChunks(['x'])))
    const disabled = new MediaGenService(disabledCtx, () => settingsWith({
      polish: { enabled: false, provider: 'deepseek', model: 'deepseek-v4-flash' },
    }))
    await expect(disabled.polishPrompt({ idea: 'ok', target: 'video' }))
      .rejects.toMatchObject({ code: 'INVALID_REQUEST' })
  })

  it('fails with EMPTY_RESPONSE when the model yields no text', async () => {
    const ctx = new Context()
    ctx.provide('llm', fakeLlm([{ type: 'finish', reason: { kind: 'stop' } }]))
    const service = new MediaGenService(ctx, () => settingsWith({}))
    await expect(service.polishPrompt({ idea: '海边的黄昏', target: 'video' }))
      .rejects.toMatchObject({ code: 'EMPTY_RESPONSE' })
  })
})
