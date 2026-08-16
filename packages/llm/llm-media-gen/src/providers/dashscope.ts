/**
 * Aliyun Bailian (DashScope) Wanx image-generation adapter. Wanx is an async
 * task API: submit with X-DashScope-Async, then poll the task until it
 * settles, then download the produced URLs.
 * @module @deepseek-ai/dsh-llm-media-gen/providers/dashscope
 */

import { LlmError } from '@deepseek-ai/dsh-llm'
import type {
  DashScopeImageGenRequest,
  GeneratedImage,
  ImageSize,
} from '../types.ts'

const POLL_INTERVAL_MS = 2000
const POLL_TIMEOUT_MS = 120_000

function parseSize(size: ImageSize | undefined): { width: number; height: number } {
  const [w, h] = (size ?? '1024x1024').split('x')
  return { width: Number(w), height: Number(h) }
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

export interface DashScopeConfig {
  apiKey: string
  baseURL: string
  model: string
}

interface TaskSubmitReply {
  output?: { task_id?: string; task_status?: string; message?: string }
  code?: string
  message?: string
}

interface TaskStatusReply {
  output?: {
    task_status?: string
    message?: string
    results?: Array<{ url?: string; code?: string; message?: string }>
  }
  code?: string
  message?: string
}

export async function generateImageDashScope(
  config: DashScopeConfig,
  request: DashScopeImageGenRequest,
  signal?: AbortSignal,
): Promise<GeneratedImage[]> {
  const { width, height } = parseSize(request.size)
  const n = Math.max(1, Math.min(4, request.n ?? 1))
  const base = config.baseURL.replace(/\/$/, '')

  const input: Record<string, unknown> = { prompt: request.prompt }
  if (request.negativePrompt !== undefined && request.negativePrompt.length > 0) {
    input.negative_prompt = request.negativePrompt
  }
  const body: Record<string, unknown> = {
    model: config.model,
    input,
    parameters: {
      size: `${width}*${height}`,
      n,
      prompt_extend: true,
    },
  }
  const headers: Record<string, string> = {
    'authorization': `Bearer ${config.apiKey}`,
    'content-type': 'application/json',
    'x-dashscope-async': 'enable',
  }

  let submit: Response
  try {
    const init: RequestInit = { method: 'POST', headers, body: JSON.stringify(body) }
    if (signal !== undefined) init.signal = signal
    submit = await fetch(`${base}/services/aigc/text2image/image-synthesis`, init)
  } catch (error) {
    if (signal?.aborted) throw error
    throw new LlmError('DashScope image submission failed', 'TRANSPORT', { cause: error })
  }
  if (!submit.ok) {
    const text = await submit.text().catch(() => '')
    throw new LlmError(
      `DashScope image submission error (HTTP ${submit.status}): ${text.slice(0, 500)}`,
      `HTTP_${submit.status}`,
      { status: submit.status },
    )
  }
  const submitted = await submit.json() as TaskSubmitReply
  const taskId = submitted.output?.task_id
  if (taskId === undefined) {
    throw new LlmError(
      `DashScope submission returned no task id: ${submitted.message ?? submitted.code ?? 'unknown'}`,
      'PROVIDER_ERROR',
    )
  }

  const deadline = Date.now() + POLL_TIMEOUT_MS
  for (;;) {
    if (signal?.aborted === true) throw new Error('aborted')
    if (Date.now() > deadline) {
      throw new LlmError('DashScope task did not settle in time', 'TIMEOUT')
    }
    await sleep(POLL_INTERVAL_MS, signal)
    const pollInit: RequestInit = { headers }
    if (signal !== undefined) pollInit.signal = signal
    const poll = await fetch(`${base}/tasks/${taskId}`, pollInit)
    if (!poll.ok) {
      throw new LlmError(
        `DashScope task poll error (HTTP ${poll.status})`,
        `HTTP_${poll.status}`,
        { status: poll.status },
      )
    }
    const status = await poll.json() as TaskStatusReply
    const taskStatus = status.output?.task_status
    if (taskStatus === 'SUCCEEDED') break
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED' || taskStatus === 'UNKNOWN') {
      throw new LlmError(
        `DashScope task ended as ${taskStatus}: ${status.output?.message ?? status.message ?? ''}`,
        'PROVIDER_ERROR',
      )
    }
  }

  const finalInit: RequestInit = { headers }
  if (signal !== undefined) finalInit.signal = signal
  const final = await fetch(`${base}/tasks/${taskId}`, finalInit)
  const settled = await final.json() as TaskStatusReply
  const urls = (settled.output?.results ?? [])
    .map(result => result.url)
    .filter((url): url is string => url !== undefined)
  if (urls.length === 0) {
    throw new LlmError('DashScope task produced no image URLs', 'EMPTY_RESPONSE')
  }

  const results: GeneratedImage[] = []
  for (const url of urls) {
    const imgInit: RequestInit = {}
    if (signal !== undefined) imgInit.signal = signal
    const imgResp = await fetch(url, imgInit)
    if (!imgResp.ok || !imgResp.body) continue
    results.push({
      data: new Uint8Array(await imgResp.arrayBuffer()),
      mediaType: 'image/png',
      width,
      height,
      provider: 'dashscope',
    })
  }
  return results
}
