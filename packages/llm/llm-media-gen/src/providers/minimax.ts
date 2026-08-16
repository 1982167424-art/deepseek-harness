import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GeneratedImage,
  GeneratedVideo,
  ImageSize,
  MiniMaxImageGenRequest,
  MiniMaxVideoGenRequest,
  ModerationImageRequest,
  ModerationResult,
} from '../types.ts'

const DEFAULT_MINIMAX_BASE_URL = 'https://api.minimax.chat/v1'
const DEFAULT_MINIMAX_IMAGE_MODEL = 'abab6.5-img'
const DEFAULT_MINIMAX_VIDEO_MODEL = 'MiniMax-H3'

function parseSizeToMM(size: ImageSize | undefined): { w: number; h: number } {
  switch (size) {
    case '256x256': return { w: 256, h: 256 }
    case '512x512': return { w: 512, h: 512 }
    case '1024x1024': return { w: 1024, h: 1024 }
    case '1024x1792': return { w: 1024, h: 1792 }
    case '1792x1024': return { w: 1792, h: 1024 }
    case '768x768': return { w: 768, h: 768 }
    case '720x1280': return { w: 720, h: 1280 }
    case '1280x720': return { w: 1280, h: 720 }
    default: return { w: 1024, h: 1024 }
  }
}

function normalizeBaseURL(baseURL: string | undefined): string {
  const value = baseURL ?? DEFAULT_MINIMAX_BASE_URL
  return value.replace(/\/$/, '')
}

export interface MiniMaxConfig {
  apiKey: string
  baseURL?: string
  groupId?: string
}

export async function generateImageMiniMax(
  config: MiniMaxConfig,
  request: MiniMaxImageGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const baseURL = normalizeBaseURL(config.baseURL)
  const { w, h } = parseSizeToMM(request.size)
  const n = Math.max(1, Math.min(4, request.n ?? 1))

  const body: Record<string, unknown> = {
    model: request.model ?? DEFAULT_MINIMAX_IMAGE_MODEL,
    prompt: request.prompt,
    size: `${w}x${h}`,
    n,
  }
  if (request.negativePrompt !== undefined) body.negative_prompt = request.negativePrompt

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }
  if (config.groupId !== undefined && config.groupId.length > 0) {
    headers['x-minimax-groupid'] = config.groupId
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${baseURL}/images/generations`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('MiniMax image generation request failed', 'TRANSPORT', { cause: error })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(
      `MiniMax image generation API error (HTTP ${response.status}): ${text.slice(0, 500)}`,
      `HTTP_${response.status}`,
      { status: response.status },
    )
  }

  const data = await response.json() as {
    created?: number
    data?: Array<{
      url?: string
      b64_json?: string
      revised_prompt?: string
    }>
  }

  const results: GeneratedImage[] = []
  const items = data.data ?? []

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
      width: w,
      height: h,
      provider: 'minimax',
    }
    if (item.revised_prompt !== undefined) generated.revisedPrompt = item.revised_prompt
    results.push(generated)
  }

  return results
}

export async function generateVideoMiniMax(
  config: MiniMaxConfig,
  request: MiniMaxVideoGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedVideo> {
  const baseURL = normalizeBaseURL(config.baseURL)
  const duration = request.duration ?? 5

  const body: Record<string, unknown> = {
    model: request.model ?? DEFAULT_MINIMAX_VIDEO_MODEL,
    prompt: request.prompt,
    duration,
  }

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }
  if (config.groupId !== undefined && config.groupId.length > 0) {
    headers['x-minimax-groupid'] = config.groupId
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${baseURL}/videos/generations`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('MiniMax video generation request failed', 'TRANSPORT', { cause: error })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(
      `MiniMax video generation API error (HTTP ${response.status}): ${text.slice(0, 500)}`,
      `HTTP_${response.status}`,
      { status: response.status },
    )
  }

  const data = await response.json() as {
    id?: string
    status?: string
    data?: {
      url?: string
      b64_json?: string
    }
  }

  let videoData: Uint8Array
  if (data.data?.b64_json) {
    videoData = Uint8Array.from(Buffer.from(data.data.b64_json, 'base64'))
  } else if (data.data?.url) {
    const vidInit: RequestInit = {}
    if (signal !== undefined) vidInit.signal = signal
    const vidResp = await fetch(data.data.url, vidInit)
    if (!vidResp.ok || !vidResp.body) {
      throw new LlmError('MiniMax video download failed', 'TRANSPORT')
    }
    videoData = new Uint8Array(await vidResp.arrayBuffer())
  } else {
    throw new LlmError('MiniMax video generation returned no video data', 'EMPTY_RESPONSE')
  }

  return {
    data: videoData,
    mediaType: 'video/mp4',
    width: 1280,
    height: 720,
    duration,
    provider: 'minimax',
  }
}

export async function moderateImageMiniMax(
  config: MiniMaxConfig,
  request: ModerationImageRequest,
  signal?: AbortSignal,
): Promise<ModerationResult> {
  const baseURL = normalizeBaseURL(config.baseURL)
  const imageBase64 = Buffer.from(request.imageData).toString('base64')

  const body: Record<string, unknown> = {
    model: 'abab6.5-moderation',
    image_base64: imageBase64,
    categories: ['pornography', 'violence', 'sensitive', 'ad'],
  }

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }
  if (config.groupId !== undefined && config.groupId.length > 0) {
    headers['x-minimax-groupid'] = config.groupId
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${baseURL}/moderation/image`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    return { safe: true, details: 'moderation transport error; allowing by default' }
  }

  if (!response.ok) {
    return { safe: true, details: `moderation returned HTTP ${response.status}; allowing by default` }
  }

  try {
    const data = await response.json() as {
      results?: Array<{
        category?: string
        score?: number
        flagged?: boolean
      }>
    }
    const flagged: string[] = []
    let maxScore = 0
    for (const result of data.results ?? []) {
      if (result.flagged === true || (result.score ?? 0) > 0.8) {
        if (result.category !== undefined) flagged.push(result.category)
      }
      if ((result.score ?? 0) > maxScore) maxScore = result.score ?? 0
    }
    const modResult: ModerationResult = { safe: flagged.length === 0 }
    if (flagged.length > 0) modResult.flagged = flagged
    if (maxScore > 0) modResult.score = maxScore
    return modResult
  } catch {
    return { safe: true, details: 'moderation parse error; allowing by default' }
  }
}
