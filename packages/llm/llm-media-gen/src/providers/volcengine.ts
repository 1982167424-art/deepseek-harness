import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  GeneratedImage,
  GeneratedVideo,
  ImageSize,
  ImageStyle,
  ModerationImageRequest,
  ModerationResult,
  VolcengineImageGenRequest,
  VolcengineVideoGenRequest,
} from '../types.ts'

const DEFAULT_VOLCENGINE_BASE_URL = 'https://visual.volcengineapi.com'
const DEFAULT_VOLCENGINE_ARK_BASE_URL = 'https://ark.cn-beijing.volces.com'
const DEFAULT_VOLCENGINE_IMAGE_MODEL = 'doubao-seedream-5-0'
const DEFAULT_VOLCENGINE_VIDEO_MODEL = 'doubao-seedance-2-5'
const ARK_POLL_INTERVAL_MS = 2000
const ARK_POLL_TIMEOUT_MS = 300_000

/** ARK model-series detection: Seedream images and Seedance videos live on the ARK API. */
function usesArk(model: string): boolean {
  return /^(doubao-seedream|doubao-seedance)/.test(model)
}

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

function mapStyle(style: ImageStyle | undefined): string {
  const mapping: Partial<Record<ImageStyle, string>> = {
    general: 'general_v2',
    photographic: 'photography',
    anime: 'anime',
    cinematic: 'cinematic',
    digital_art: 'digital_art',
    oil_painting: 'oil_painting',
    watercolor: 'watercolor',
    sketch: 'sketch',
    '3d_render': '3d_render',
  }
  return style !== undefined ? (mapping[style] ?? 'general_v2') : 'general_v2'
}

function normalizeBaseURL(baseURL: string | undefined): string {
  const value = baseURL ?? DEFAULT_VOLCENGINE_BASE_URL
  return value.replace(/\/$/, '')
}

export interface VolcengineConfig {
  apiKey: string
  baseURL?: string
  /** Ark (model-routing) base URL for Seedream/Seedance model series. */
  arkBaseURL?: string
  /** Image model id; Seedream series route to the Ark images API. */
  imageModel?: string
  /** Video model id; Seedance series route to the Ark contents-task API. */
  videoModel?: string
}

function arkBase(config: VolcengineConfig): string {
  return (config.arkBaseURL ?? DEFAULT_VOLCENGINE_ARK_BASE_URL).replace(/\/$/, '')
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }, { once: true })
  })
}

/** Ark images API for the Seedream series: sync call returning URL/b64 payloads. */
async function generateImageArk(
  config: VolcengineConfig,
  request: VolcengineImageGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const { width, height } = parseSize(request.size)
  const n = Math.max(1, Math.min(4, request.n ?? 1))
  const model = config.imageModel ?? DEFAULT_VOLCENGINE_IMAGE_MODEL

  const body: Record<string, unknown> = {
    model,
    prompt: request.prompt,
    size: `${width}x${height}`,
    response_format: 'url',
    watermark: false,
  }
  if (n > 1) body.seq = n
  if (request.negativePrompt !== undefined && request.negativePrompt.length > 0) {
    body.negative_prompt = request.negativePrompt
  }

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${arkBase(config)}/api/v3/images/generations`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('Volcengine Ark image generation request failed', 'TRANSPORT', { cause: error })
  }
  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(
      `Volcengine Ark image API error (HTTP ${response.status}): ${text.slice(0, 500)}`,
      `HTTP_${response.status}`,
      { status: response.status },
    )
  }
  const data = await response.json() as {
    data?: Array<{ url?: string; b64_json?: string; revised_prompt?: string }>
  }
  const items = data.data ?? []
  if (items.length === 0) {
    throw new LlmError('Volcengine Ark image API returned no images', 'EMPTY_RESPONSE')
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
      revisedPrompt: item.revised_prompt ?? request.prompt,
      provider: 'volcengine',
    }
    results.push(generated)
  }
  return results
}

export async function generateImageVolcengine(
  config: VolcengineConfig,
  request: VolcengineImageGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const model = config.imageModel ?? DEFAULT_VOLCENGINE_IMAGE_MODEL
  if (usesArk(model)) return generateImageArk(config, request, signal)

  const baseURL = normalizeBaseURL(config.baseURL)
  const { width, height } = parseSize(request.size)
  const n = Math.max(1, Math.min(4, request.n ?? 1))

  const body: Record<string, unknown> = {
    req_key: `img_${Date.now()}`,
    model,
    prompt: request.prompt,
    width,
    height,
    image_num: n,
    style: mapStyle(request.style),
  }
  if (request.negativePrompt !== undefined) body.negative_prompt = request.negativePrompt

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${baseURL}/api/v1/tasks/text2image`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('Volcengine image generation request failed', 'TRANSPORT', { cause: error })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(
      `Volcengine image generation API error (HTTP ${response.status}): ${text.slice(0, 500)}`,
      `HTTP_${response.status}`,
      { status: response.status },
    )
  }

  const data = await response.json() as {
    code?: number
    message?: string
    data?: {
      task_id?: string
      status?: string
      images?: Array<{ url?: string; image_data?: string }>
    }
  }

  if (data.code !== undefined && data.code !== 0) {
    throw new LlmError(
      `Volcengine image generation API error: ${data.message ?? `code=${data.code}`}`,
      'PROVIDER_ERROR',
    )
  }

  const results: GeneratedImage[] = []
  const images = data.data?.images ?? []

  for (const image of images) {
    let imageData: Uint8Array
    if (image.image_data) {
      imageData = Uint8Array.from(Buffer.from(image.image_data, 'base64'))
    } else if (image.url) {
      const imgInit: RequestInit = {}
      if (signal !== undefined) imgInit.signal = signal
      const imgResp = await fetch(image.url, imgInit)
      if (!imgResp.ok || !imgResp.body) continue
      imageData = new Uint8Array(await imgResp.arrayBuffer())
    } else {
      continue
    }
    results.push({
      data: imageData,
      mediaType: 'image/png',
      width,
      height,
      revisedPrompt: request.prompt,
      provider: 'volcengine',
    })
  }

  return results
}

/** Ark contents-task API for the Seedance series: submit, poll, download. */
async function generateVideoArk(
  config: VolcengineConfig,
  request: VolcengineVideoGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedVideo> {
  const model = request.model ?? config.videoModel ?? DEFAULT_VOLCENGINE_VIDEO_MODEL
  const duration = request.duration ?? 5
  const ratio = request.ratio ?? '16:9'
  const base = arkBase(config)
  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }

  const submitBody = {
    model,
    content: [{
      type: 'text',
      text: `--ratio ${ratio} --duration ${duration}${request.size !== undefined ? ` --resolution ${request.size}` : ''} ${request.prompt}`,
    }],
  }

  let submit: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(submitBody) }
    if (signal !== undefined) init.signal = signal
    submit = await fetch(`${base}/api/v3/contents/generations/tasks`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('Volcengine Ark video submission failed', 'TRANSPORT', { cause: error })
  }
  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new LlmError(
      `Volcengine Ark video submission error (HTTP ${submit.status}): ${text.slice(0, 500)}`,
      `HTTP_${submit.status}`,
      { status: submit.status },
    )
  }
  const submitted = await submit.json() as { id?: string }
  const taskId = submitted.id
  if (taskId === undefined) {
    throw new LlmError('Volcengine Ark video submission returned no task id', 'EMPTY_RESPONSE')
  }

  const deadline = Date.now() + ARK_POLL_TIMEOUT_MS
  let videoUrl: string | undefined
  for (;;) {
    if (signal?.aborted === true) throw new Error('aborted')
    if (Date.now() > deadline) {
      throw new LlmError('Volcengine Ark video task did not settle in time', 'TIMEOUT')
    }
    await sleep(ARK_POLL_INTERVAL_MS, signal)
    const pollInit: RequestInit = { headers }
    if (signal !== undefined) pollInit.signal = signal
    const poll = await fetch(`${base}/api/v3/contents/generations/tasks/${taskId}`, pollInit)
    if (!poll.ok) {
      throw new LlmError(
        `Volcengine Ark video task poll error (HTTP ${poll.status})`,
        `HTTP_${poll.status}`,
        { status: poll.status },
      )
    }
    const status = await poll.json() as {
      status?: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
      error?: { message?: string }
      content?: { video_url?: string }
    }
    if (status.status === 'succeeded') {
      videoUrl = status.content?.video_url
      break
    }
    if (status.status === 'failed' || status.status === 'cancelled') {
      throw new LlmError(
        `Volcengine Ark video task ended as ${status.status}: ${status.error?.message ?? ''}`,
        'PROVIDER_ERROR',
      )
    }
  }
  if (videoUrl === undefined) {
    throw new LlmError('Volcengine Ark video task produced no video URL', 'EMPTY_RESPONSE')
  }

  const vidInit: RequestInit = {}
  if (signal !== undefined) vidInit.signal = signal
  const videoResp = await fetch(videoUrl, vidInit)
  if (!videoResp.ok || !videoResp.body) {
    throw new LlmError('Volcengine video download failed', 'TRANSPORT')
  }
  const vWidth = ratio === '9:16' ? 720 : 1280
  const vHeight = ratio === '9:16' ? 1280 : 720
  return {
    data: new Uint8Array(await videoResp.arrayBuffer()),
    mediaType: 'video/mp4',
    width: vWidth,
    height: vHeight,
    duration,
    provider: 'volcengine',
  }
}

export async function generateVideoVolcengine(
  config: VolcengineConfig,
  request: VolcengineVideoGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedVideo> {
  const model = request.model ?? config.videoModel ?? DEFAULT_VOLCENGINE_VIDEO_MODEL
  if (usesArk(model)) {
    const arkRequest = { ...request, model }
    return generateVideoArk(config, arkRequest, signal)
  }

  const baseURL = normalizeBaseURL(config.baseURL)
  const duration = request.duration ?? 5
  const fps = request.fps ?? 24
  const ratio = request.ratio ?? '16:9'

  const body: Record<string, unknown> = {
    req_key: `vid_${Date.now()}`,
    model,
    prompt: request.prompt,
    duration,
    fps,
    ratio,
  }
  if (request.size !== undefined) body.resolution = request.size

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${baseURL}/api/v1/tasks/text2video`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('Volcengine video generation request failed', 'TRANSPORT', { cause: error })
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new LlmError(
      `Volcengine video generation API error (HTTP ${response.status}): ${text.slice(0, 500)}`,
      `HTTP_${response.status}`,
      { status: response.status },
    )
  }

  const data = await response.json() as {
    code?: number
    message?: string
    data?: {
      task_id?: string
      video_url?: string
    }
  }

  if (data.code !== undefined && data.code !== 0) {
    throw new LlmError(
      `Volcengine video generation API error: ${data.message ?? `code=${data.code}`}`,
      'PROVIDER_ERROR',
    )
  }

  const videoURL = data.data?.video_url
  if (!videoURL) {
    throw new LlmError('Volcengine video generation returned no video URL', 'EMPTY_RESPONSE')
  }

  const vidInit: RequestInit = {}
  if (signal !== undefined) vidInit.signal = signal
  const videoResp = await fetch(videoURL, vidInit)
  if (!videoResp.ok || !videoResp.body) {
    throw new LlmError('Volcengine video download failed', 'TRANSPORT')
  }
  const videoData = new Uint8Array(await videoResp.arrayBuffer())

  const vWidth = ratio === '9:16' ? 720 : 1280
  const vHeight = ratio === '9:16' ? 1280 : 720

  return {
    data: videoData,
    mediaType: 'video/mp4',
    width: vWidth,
    height: vHeight,
    duration,
    provider: 'volcengine',
  }
}

export async function moderateImageVolcengine(
  config: VolcengineConfig,
  request: ModerationImageRequest,
  signal?: AbortSignal,
): Promise<ModerationResult> {
  const baseURL = normalizeBaseURL(config.baseURL)
  const imageBase64 = Buffer.from(request.imageData).toString('base64')

  const body: Record<string, unknown> = {
    req_key: `mod_${Date.now()}`,
    image_base64: imageBase64,
    scenes: ['porn', 'violence', 'sensitive_figure', 'ad'],
  }

  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
  }

  let response: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    response = await fetch(`${baseURL}/api/v1/tasks/image_moderation`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    return { safe: true, details: 'moderation transport error; allowing by default' }
  }

  if (!response.ok) {
    return { safe: true, details: `moderation returned HTTP ${response.status}; allowing by default` }
  }

  try {
    const data = await response.json() as {
      code?: number
      data?: {
        results?: Array<{ label?: string; suggestion?: string; score?: number }>
      }
    }
    const flagged: string[] = []
    let maxScore = 0
    for (const result of data.data?.results ?? []) {
      if (result.suggestion === 'block' || (result.score ?? 0) > 0.8) {
        if (result.label !== undefined && result.label.length > 0) flagged.push(result.label)
      }
      if ((result.score ?? 0) > maxScore) maxScore = result.score ?? 0
    }
    const modResult: ModerationResult = { safe: flagged.length === 0 }
    if (flagged.length > 0) modResult.flagged = flagged
    if (maxScore > 0) modResult.score = maxScore
    if (data.code !== undefined && data.code !== 0) modResult.details = `code=${data.code}`
    return modResult
  } catch {
    return { safe: true, details: 'moderation parse error; allowing by default' }
  }
}
