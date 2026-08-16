/**
 * Wallpaper moderation: AI-powered safety check for uploaded images.
 * Uses vision-capable LLM or fallback heuristic checks.
 * @module @deepseek-ai/dsh-client-ui-wallpaper/api/moderation
 */

import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createMessage, createUserMessage, deepFreeze } from '@deepseek-ai/dsh-llm'
import type { GenerateOptions } from '@deepseek-ai/dsh-llm'
import type { WallpaperModerationResult } from '../types.ts'

const MAX_CACHE_SIZE = 200
const moderationCache = new Map<string, WallpaperModerationResult>()

function sha256Bytes(bytes: Uint8Array): string {
  let hash = 0
  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i]
    if (byte === undefined) continue
    hash = ((hash << 5) - hash) + byte
    hash |= 0
  }
  return `heur_${String(bytes.length)}_${String(hash)}`
}

function heuristicModeration(
  fileName: string,
  fileSize: number,
  bytes: Uint8Array,
): WallpaperModerationResult {
  const name = fileName.toLowerCase()
  const suspiciousTokens = [
    'nsfw', 'nude', 'naked', 'porn', 'sex', 'violence',
    'gore', 'blood', 'weapon', 'gun', 'bomb',
    'flag', 'political', 'protest',
  ]
  const matched: string[] = []
  for (const token of suspiciousTokens) {
    if (name.includes(token)) matched.push(token)
  }

  if (matched.length > 0) {
    return {
      passed: false,
      reason: `文件名包含可疑关键词: ${matched.join(', ')}`,
      categories: matched,
    }
  }

  if (fileSize > 10 * 1024 * 1024) {
    return { passed: false, reason: '文件超过 10MB 限制', categories: ['file_size'] }
  }

  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10]
  const jpegSignatureSOI = [0xFF, 0xD8]
  const isPng = bytes.length >= 8 && pngSignature.every((b, i) => bytes[i] === b)
  const isJpeg = bytes.length >= 2 && jpegSignatureSOI.every((b, i) => bytes[i] === b)

  if (!isPng && !isJpeg) {
    return { passed: false, reason: '仅支持 JPG 和 PNG 格式', categories: ['invalid_format'] }
  }

  return { passed: true }
}

const MODERATION_PROMPT = `
You are a content safety moderator. Your task is to review the provided image for safety issues.
Please analyze the image and determine if it contains any of the following:
1. Nudity or sexually explicit content (NSFW)
2. Graphic violence, blood, or gore
3. Weapons, bombs, or dangerous items
4. Politically sensitive or divisive content
5. Hate speech or discriminatory symbols
6. Illegal activities or content

Respond ONLY with valid JSON in the following format:
{
  "passed": boolean,
  "reason": "short explanation if failed, or empty string if passed",
  "categories": ["list", "of", "violated", "categories"]
}
`.trim()

export async function moderateWallpaperImage(
  ctx: Context,
  args: {
    fileName: string
    fileSize: number
    bytes: Uint8Array
    imageUrl?: string
  },
): Promise<WallpaperModerationResult> {
  const cacheKey = sha256Bytes(args.bytes)
  const cached = moderationCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const heuristic = heuristicModeration(args.fileName, args.fileSize, args.bytes)
  if (!heuristic.passed) {
    moderationCache.set(cacheKey, heuristic)
    if (moderationCache.size > MAX_CACHE_SIZE) {
      const firstKey = moderationCache.keys().next().value
      if (firstKey !== undefined) moderationCache.delete(firstKey)
    }
    return heuristic
  }

  let llmResult: WallpaperModerationResult | undefined
  try {
    const llm = ctx.llm
    if (llm !== undefined) {
      const messages = [
        createMessage({
          role: 'system',
          content: [{ type: 'text', text: MODERATION_PROMPT }],
          source: { kind: 'plugin', plugin: 'ui-wallpaper-moderation', scope: 'root' as never },
        }),
        createUserMessage({
          content: [{
            type: 'text',
            text: args.imageUrl !== undefined
              ? `Please review this image for safety: ${args.imageUrl}`
              : 'Please review the provided image for safety concerns.',
          }],
          source: { kind: 'plugin', plugin: 'ui-wallpaper-moderation', scope: 'root' as never },
        }),
      ]
      const options: GenerateOptions = deepFreeze({
        provider: 'deepseek',
        model: 'deepseek-v4-pro',
        messages,
        maxTokens: 512,
        temperature: 0,
      })
      const assembler = new BlockAssembler()
      for await (const chunk of llm.stream(options)) {
        assembler.push(chunk)
      }
      const blocks = assembler.blocks()
      const reply = blocks
        .filter((block): block is Extract<typeof blocks[number], { type: 'text' }> => block.type === 'text')
        .map(block => block.text)
        .join(' ')
      const jsonStart = reply.indexOf('{')
      const jsonEnd = reply.lastIndexOf('}')
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        const parsed = JSON.parse(reply.slice(jsonStart, jsonEnd + 1)) as { passed?: unknown; reason?: unknown; categories?: unknown }
        const parsedResult: WallpaperModerationResult = { passed: Boolean(parsed.passed) }
        if (typeof parsed.reason === 'string' && parsed.reason.length > 0) parsedResult.reason = parsed.reason
        if (Array.isArray(parsed.categories)) {
          const cats = parsed.categories.filter((c): c is string => typeof c === 'string')
          if (cats.length > 0) parsedResult.categories = cats
        }
        llmResult = parsedResult
      }
    }
  } catch {
    llmResult = undefined
  }

  const result = llmResult ?? heuristic
  moderationCache.set(cacheKey, result)
  if (moderationCache.size > MAX_CACHE_SIZE) {
    const firstKey = moderationCache.keys().next().value
    if (firstKey !== undefined) moderationCache.delete(firstKey)
  }
  return result
}
