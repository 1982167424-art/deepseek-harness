/**
 * Shared OpenAI-compatible image-generation adapter. OpenAI, Zhipu, SiliconFlow,
 * AihubMix, Tokenflux, and NewAPI all expose POST {baseURL}/images/generations
 * with only response-envelope differences, folded here into one parser.
 * @module @deepseek-ai/dsh-llm-media-gen/providers/openai-compatible
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GeneratedImage,
  ImageSize,
  MediaProvider,
  OpenAICompatibleImageGenRequest,
} from '../types.ts'

function parseSize(size: ImageSize | undefined): { width: number; height: number } {
  switch (size) {
    case '256x256': return { width: 256, height: 256 }
    case '512x512': return { width: 512, height: 512 }
    case '1024x1024': return { width: 1024, height: 1024 }
    case '1024x1792': return { width: 1024, height: 1792 }
    case '1792x1024': return { width: 1792, height: 1024 }
    case '768x768': return { width: 768, height: 768 }
    case '720x1280': return { width: 720, height: 1280 }
    case '1280x720': return { width: 1280, height: 720 }
    default: return { width: 1024, height: 1024 }
  }
}

export interface OpenAICompatibleConfig {
  apiKey: string
  baseURL: string
  model: string
  provider: MediaProvider
}

/** One accepted response item across the supported envelopes. */
interface ImageEnvelopeItem {
  b64_json?: string
  url?: string
  revised_prompt?: string
}

function envelopeItems(data: unknown): ImageEnvelopeItem[] {
  const root = data as {
    data?: ImageEnvelopeItem[]
    images?: ImageEnvelopeItem[]
    output?: ImageEnvelopeItem[]
  }
  return root.data ?? root.images ?? root.output ?? []
}

/** OpenAI-compatible endpoints have no negative-prompt field; fold it into the prompt. */
function composePrompt(request: OpenAICompatibleImageGenRequest): string {
  if (request.negativePrompt === undefined || request.negativePrompt.length === 0) {
    return request.prompt
  }
  return `${request.prompt} (avoid: ${request.negativePrompt})`
}

export async function generateImageOpenAICompatible(
  config: OpenAICompatibleConfig,
  request: OpenAICompatibleImageGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const { width, height } = parseSize(request.size)
  const n = Math.max(1, Math.min(4, request.n ?? 1))

  const body: Record<string, unknown> = {
    model: config.model,
    prompt: composePrompt(request),
    n,
    size: `${width}x${height}`,
  }
  if (config.provider === 'openai') body.moderation = 'low'

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${config.baseURL.replace(/\/$/, '')}/images/generations`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError(
      `${config.provider} image generation request failed`,
      'TRANSPORT',
      { cause: error },
    )
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(
      `${config.provider} image generation API error (HTTP ${response.status}): ${text.slice(0, 500)}`,
      `HTTP_${response.status}`,
      { status: response.status },
    )
  }

  const items = envelopeItems(await response.json())
  if (items.length === 0) {
    throw new LlmError(
      `${config.provider} image generation returned no images`,
      'EMPTY_RESPONSE',
    )
  }

  const results: GeneratedImage[] = []
  for (const item of items) {
    let imageData: Uint8Array
    if (item.b64_json) {
      imageData = Uint8Array.from(Buffer.from(item.b64_json, 'base64'))
    } else if (item.url) {
      const imgInit: RequestInit = {}
      if (signal !== undefined) imgInit.signal = signal
      const imgResp = await fetch(item.url, imgInit)
      if (!imgResp.ok || !imgResp.body) continue
      imageData = new Uint8Array(await imgResp.arrayBuffer())
    } else {
      continue
    }
    const generated: GeneratedImage = {
      data: imageData,
      mediaType: 'image/png',
      width,
      height,
      provider: config.provider,
    }
    if (item.revised_prompt !== undefined) generated.revisedPrompt = item.revised_prompt
    results.push(generated)
  }
  return results
}
