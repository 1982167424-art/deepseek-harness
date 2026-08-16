/**
 * Host plugin for wallpaper studio: upload, AI moderation, storage,
 * and durable user settings (fit mode, opacity, blur).
 *
 * Inject: ['webServer', 'llm', 'storage', 'credentials', 'settings']
 *
 * @module @deepseek-ai/dsh-client-ui-wallpaper
 */

import { Context, Service } from '@deepseek-ai/cordis'
import { randomUUID } from 'crypto'
import type { IncomingMessage, ServerResponse } from 'http'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-storage'
import type {} from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-settings'
import type {
  GenerateImageArgs, GenerateModelArgs, GenerateVideoArgs, ImageSize, ImageStyle,
  MediaProvider, ModelFileFormat, ModelSubdivision,
} from '@deepseek-ai/dsh-llm-media-gen'
import { IMAGE_PROVIDERS, MODEL_PROVIDERS, VIDEO_PROVIDERS } from '@deepseek-ai/dsh-llm-media-gen'
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  GenerateWallpaperRequest, GenerateWallpaperResponse, ListWallpapersResponse,
  PolishWallpaperRequest, PolishWallpaperResponse, UploadWallpaperResponse,
  WallpaperActiveSettings, WallpaperFitMode, WallpaperGenerateKind,
  WallpaperId, WallpaperItem, WallpaperModerationResult, WallpaperSettings,
} from './types.ts'
import { DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_BLUR } from './types.ts'
import { moderateWallpaperImage } from './api/moderation.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    wallpaper: WallpaperService
  }
}

export type {
  ListWallpapersResponse, UploadWallpaperResponse,
  WallpaperActiveSettings, WallpaperFitMode, WallpaperId, WallpaperItem,
  WallpaperModerationResult, WallpaperSettings,
} from './types.ts'

export const WALLPAPER_SETTINGS_NAMESPACE = settingsNamespace('ui-wallpaper')

const WALLPAPER_SETTINGS_SCHEMA = z.object({
  fitMode: z.union([z.const('cover'), z.const('contain'), z.const('tile'), z.const('stretch')]).default('cover'),
  opacity: z.number().min(0).max(1).default(0.85),
  blur: z.number().min(0).max(20).default(0),
})

export { DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_BLUR } from './types.ts'
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png'])
/** URL imports must end in a JPG/JPEG/PNG path segment, optionally followed by query or fragment. */
const URL_IMAGE_EXT = /\.(?:jpe?g|png)(?:[?#]|$)/i

/** One stored medium behind a `/api/wallpaper/temp/` URL. */
interface WallpaperBlob {
  data: Uint8Array
  mediaType: string
}

class WallpaperStore {
  private readonly items = new Map<WallpaperId, WallpaperItem>()
  private readonly order: WallpaperId[] = []
  private readonly blobs = new Map<WallpaperId, WallpaperBlob>()

  add(item: WallpaperItem): void {
    if (!this.items.has(item.id)) {
      this.order.push(item.id)
    }
    this.items.set(item.id, item)
  }

  get(id: WallpaperId): WallpaperItem | undefined {
    return this.items.get(id)
  }

  list(): WallpaperItem[] {
    return this.order
      .map(id => this.items.get(id))
      .filter((item): item is WallpaperItem => item !== undefined)
  }

  delete(id: WallpaperId): boolean {
    const existed = this.items.delete(id)
    this.blobs.delete(id)
    const idx = this.order.indexOf(id)
    if (idx >= 0) this.order.splice(idx, 1)
    return existed
  }

  update(id: WallpaperId, patch: Partial<WallpaperItem>): WallpaperItem | undefined {
    const existing = this.items.get(id)
    if (existing === undefined) return undefined
    const next = { ...existing, ...patch }
    this.items.set(id, next)
    return next
  }

  setBlob(id: WallpaperId, blob: WallpaperBlob): void {
    this.blobs.set(id, blob)
  }

  getBlob(id: WallpaperId): WallpaperBlob | undefined {
    return this.blobs.get(id)
  }
}

export class WallpaperService extends Service {
  static inject = ['webServer', 'llm', 'storage', 'credentials', 'settings']

  private readonly store = new WallpaperStore()
  private resolvedSettings: WallpaperSettings = {
    fitMode: DEFAULT_FIT,
    opacity: DEFAULT_OPACITY,
    blur: DEFAULT_BLUR,
  }

  constructor(ctx: Context) {
    super(ctx, 'wallpaper')
    const entry: WallpaperSettings = {
      fitMode: DEFAULT_FIT,
      opacity: DEFAULT_OPACITY,
      blur: DEFAULT_BLUR,
    }
    let source: () => WallpaperSettings = () => entry
    installSettingsSection(
      ctx,
      WALLPAPER_SETTINGS_NAMESPACE,
      WALLPAPER_SETTINGS_SCHEMA as unknown as z<WallpaperSettings>,
      entry,
      {
        validate: (value) => {
          if (value.opacity === undefined || value.opacity === null
            || value.opacity < 0 || value.opacity > 1) {
            throw new Error('opacity must be between 0 and 1')
          }
          if (value.blur === undefined || value.blur === null
            || value.blur < 0 || value.blur > 20) {
            throw new Error('blur must be between 0 and 20')
          }
        },
        setSource: (current) => {
          source = current as unknown as () => WallpaperSettings
        },
        onChange: () => {
          this.resolvedSettings = source()
        },
      },
    )
    this.resolvedSettings = source()

    ctx.effect(() => this.registerApiEndpoints(), 'wallpaper: api endpoints')
  }

  private sendJson(res: ServerResponse, statusCode: number, payload: unknown): void {
    res.statusCode = statusCode
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify(payload))
  }

  private registerApiEndpoints(): () => void {
    const disposers: (() => void)[] = []

    const webServer = this.ctx.webServer
    if (webServer === undefined) return () => {}

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/upload',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const contentType = req.headers['content-type'] ?? ''
          const isMultipart = contentType.startsWith('multipart/form-data')
          let fileName = `wallpaper_${Date.now()}`
          let mimeType = 'image/png'
          let fileBytes: Uint8Array | undefined
          let imageUrl: string | undefined

          if (isMultipart) {
            const body = (req as unknown as { body?: { file?: { name?: string; data?: Uint8Array; mimetype?: string }; url?: string } }).body ?? {}
            if (body.file?.data !== undefined) {
              fileBytes = body.file.data
              fileName = body.file.name ?? fileName
              mimeType = body.file.mimetype ?? mimeType
            }
            if (body.url !== undefined) {
              imageUrl = body.url
            }
          } else {
            const jsonBody = await this.parseJsonBody(req)
            if (jsonBody?.url !== undefined) {
              imageUrl = jsonBody.url as string
            }
          }

          if (fileBytes === undefined && imageUrl === undefined) {
            this.sendJson(res, 400, { error: 'No file or URL provided' })
            return
          }

          if (fileBytes === undefined && imageUrl !== undefined && !URL_IMAGE_EXT.test(imageUrl)) {
            this.sendJson(res, 400, { error: 'URL 导入仅支持 .jpg / .jpeg / .png 图片' })
            return
          }

          if (fileBytes !== undefined) {
            if (!ALLOWED_MIME.has(mimeType.toLowerCase())) {
              this.sendJson(res, 400, { error: '仅支持 JPG 和 PNG 格式' })
              return
            }
            if (fileBytes.length > MAX_FILE_SIZE) {
              this.sendJson(res, 400, { error: '文件超过 10MB 限制' })
              return
            }
          }

          const id = `wp_${randomUUID()}` as WallpaperId
          const tempUrl = `/api/wallpaper/temp/${id}`
          const item: WallpaperItem = {
            id,
            name: fileName,
            url: tempUrl,
            createdAt: Date.now(),
            moderationStatus: 'pending',
            source: imageUrl !== undefined ? 'url' : 'upload',
          }
          this.store.add(item)

          const response: UploadWallpaperResponse = {
            id,
            tempUrl,
            moderationStatus: 'pending',
          }

          void (async () => {
            try {
              const bytes = fileBytes ?? new Uint8Array()
              const moderationArgs: { fileName: string; fileSize: number; bytes: Uint8Array; imageUrl?: string } = {
                fileName,
                fileSize: bytes.length,
                bytes,
              }
              if (imageUrl !== undefined) moderationArgs.imageUrl = imageUrl
              const result = await moderateWallpaperImage(this.ctx, moderationArgs)
              const updatePatch: Partial<WallpaperItem> = {
                moderationStatus: result.passed ? 'passed' : 'rejected',
                url: imageUrl ?? tempUrl,
              }
              if (result.reason !== undefined) updatePatch.moderationReason = result.reason
              if (result.categories !== undefined) updatePatch.moderationCategories = result.categories
              this.store.update(id, updatePatch)
            } catch (error: unknown) {
              this.store.update(id, {
                moderationStatus: 'rejected',
                moderationReason: error instanceof Error ? error.message : '审核失败',
              })
            }
          })()

          this.sendJson(res, 200, response)
        } catch (error: unknown) {
          this.sendJson(res, 500, { error: error instanceof Error ? error.message : 'Upload failed' })
        }
      },
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/moderate',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await this.parseJsonBody(req)
          const wallpaperId = body?.wallpaperId as WallpaperId | undefined
          if (wallpaperId === undefined) {
            this.sendJson(res, 400, { error: 'wallpaperId is required' })
            return
          }
          const item = this.store.get(wallpaperId)
          if (item === undefined) {
            this.sendJson(res, 404, { error: 'Wallpaper not found' })
            return
          }
          if (item.moderationStatus === 'passed' || item.moderationStatus === 'rejected') {
            const result: WallpaperModerationResult = item.moderationStatus === 'passed'
              ? (() => {
                const r: WallpaperModerationResult = { passed: true }
                if (item.moderationReason !== undefined) r.reason = item.moderationReason
                if (item.moderationCategories !== undefined) r.categories = item.moderationCategories
                return r
              })()
              : (() => {
                const r: WallpaperModerationResult = { passed: false }
                if (item.moderationReason !== undefined) r.reason = item.moderationReason
                if (item.moderationCategories !== undefined) r.categories = item.moderationCategories
                return r
              })()
            this.sendJson(res, 200, result)
            return
          }
          const pendingResult: WallpaperModerationResult = { passed: false, reason: '审核中' }
          this.sendJson(res, 200, pendingResult)
        } catch (error: unknown) {
          this.sendJson(res, 500, { error: error instanceof Error ? error.message : 'Moderation failed' })
        }
      },
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/providers',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        this.sendJson(res, 200, {
          image: [...IMAGE_PROVIDERS],
          video: [...VIDEO_PROVIDERS],
          model: [...MODEL_PROVIDERS],
        })
      },
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/polish',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const mediaGen = this.ctx.get('mediaGen')
          if (mediaGen === undefined) {
            this.sendJson(res, 503, { error: '媒体生成服务不可用（llm-media-gen 未加载）' })
            return
          }
          const body = await this.parseJsonBody(req)
          const idea = typeof body?.idea === 'string' ? body.idea : ''
          if (idea.trim().length === 0) {
            this.sendJson(res, 400, { error: 'idea is required' })
            return
          }
          const targetIn = typeof body?.target === 'string' ? body.target : 'image'
          const target: WallpaperGenerateKind = targetIn === 'video'
            ? 'video'
            : targetIn === 'model'
              ? 'model'
              : 'image'
          const request: PolishWallpaperRequest = { idea, target }
          const result = await mediaGen.polishPrompt(request)
          const response: PolishWallpaperResponse = {
            polishedPrompt: result.polishedPrompt,
            provider: result.provider,
            model: result.model,
          }
          this.sendJson(res, 200, response)
        } catch (error: unknown) {
          this.sendJson(res, 500, { error: error instanceof Error ? error.message : '润色失败' })
        }
      },
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/generate',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const mediaGen = this.ctx.get('mediaGen')
          if (mediaGen === undefined) {
            this.sendJson(res, 503, { error: '媒体生成服务不可用（llm-media-gen 未加载）' })
            return
          }
          const body = await this.parseJsonBody(req)
          const request = this.parseGenerateRequest(body)
          if (request === undefined) {
            this.sendJson(res, 400, { error: 'prompt is required' })
            return
          }
          const created: WallpaperItem[] = []
          if (request.kind === 'video') {
            const args: GenerateVideoArgs = { prompt: request.prompt }
            if (request.provider !== undefined) args.provider = request.provider as MediaProvider
            if (request.duration !== undefined) args.duration = request.duration
            if (request.ratio === '16:9' || request.ratio === '9:16' || request.ratio === '1:1') {
              args.ratio = request.ratio
            }
            const video = await mediaGen.generateVideo(args)
            created.push(this.storeGeneratedMedia({
              media: 'video',
              bytes: video.data,
              mediaType: video.mediaType,
              provider: video.provider,
              prompt: request.prompt,
            }))
          } else if (request.kind === 'model') {
            const args: GenerateModelArgs = { prompt: request.prompt }
            if (request.provider !== undefined) args.provider = request.provider as MediaProvider
            if (typeof request.imageUrl === 'string' && request.imageUrl.length > 0) {
              args.imageUrl = request.imageUrl
            }
            const subdivisions: readonly ModelSubdivision[] = ['low', 'medium', 'high']
            if (typeof request.subdivision === 'string'
              && subdivisions.includes(request.subdivision as ModelSubdivision)) {
              args.subdivision = request.subdivision as ModelSubdivision
            }
            const formats: readonly ModelFileFormat[] = ['glb', 'obj', 'usd', 'usdz']
            if (typeof request.fileFormat === 'string'
              && formats.includes(request.fileFormat as ModelFileFormat)) {
              args.fileFormat = request.fileFormat as ModelFileFormat
            }
            if (typeof request.model === 'string' && request.model.length > 0) {
              args.model = request.model
            }
            const model = await mediaGen.generateModel(args)
            created.push(this.storeGeneratedMedia({
              media: 'model',
              bytes: model.data,
              mediaType: model.mediaType,
              provider: model.provider,
              prompt: request.prompt,
              modelFileFormat: model.fileFormat,
              modelSubdivision: model.subdivision,
            }))
          } else {
            const args: GenerateImageArgs = { prompt: request.prompt }
            if (request.provider !== undefined) args.provider = request.provider as MediaProvider
            if (request.size !== undefined) args.size = request.size as ImageSize
            if (request.style !== undefined) args.style = request.style as ImageStyle
            if (request.n !== undefined) args.n = request.n
            const images = await mediaGen.generateImage(args)
            for (const image of images) {
              created.push(this.storeGeneratedMedia({
                media: 'image',
                bytes: image.data,
                mediaType: image.mediaType,
                provider: image.provider,
                prompt: request.prompt,
              }))
            }
          }
          const response: GenerateWallpaperResponse = { items: created }
          this.sendJson(res, 200, response)
        } catch (error: unknown) {
          this.sendJson(res, 500, { error: error instanceof Error ? error.message : '生成失败' })
        }
      },
    }))

    disposers.push(webServer.register({
      kind: 'prefix',
      path: '/api/wallpaper/temp',
      handler: (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'GET') {
          res.statusCode = 405
          res.end()
          return
        }
        const url = new URL(req.url ?? '/', 'http://x')
        const id = url.pathname.slice('/api/wallpaper/temp/'.length) as WallpaperId
        const blob = this.store.getBlob(id)
        if (blob === undefined) {
          this.sendJson(res, 404, { error: 'Media not found' })
          return
        }
        res.statusCode = 200
        res.setHeader('Content-Type', blob.mediaType)
        res.setHeader('Cache-Control', 'private, max-age=86400')
        res.end(Buffer.from(blob.data.buffer, blob.data.byteOffset, blob.data.byteLength))
      },
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/list',
      handler: (_req: IncomingMessage, res: ServerResponse) => {
        const activeSettings: WallpaperActiveSettings = {
          fitMode: this.resolvedSettings.fitMode,
          opacity: this.resolvedSettings.opacity,
          blur: this.resolvedSettings.blur,
        }
        if (this.resolvedSettings.activeWallpaperId !== undefined) {
          activeSettings.activeWallpaperId = this.resolvedSettings.activeWallpaperId
        }
        const response: ListWallpapersResponse = {
          items: this.store.list(),
          activeSettings,
        }
        this.sendJson(res, 200, response)
      },
    }))

    disposers.push(webServer.register({
      kind: 'exact',
      path: '/api/wallpaper/set-active',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        try {
          const body = await this.parseJsonBody(req)
          const wallpaperId = body?.wallpaperId as WallpaperId | undefined
          const fitMode = (body?.fitMode as WallpaperFitMode | undefined) ?? this.resolvedSettings.fitMode
          const opacity = Number(body?.opacity ?? this.resolvedSettings.opacity)
          const blur = Number(body?.blur ?? this.resolvedSettings.blur)

          if (!['cover', 'contain', 'tile', 'stretch'].includes(fitMode)) {
            this.sendJson(res, 400, { error: 'Invalid fitMode' })
            return
          }
          if (opacity < 0 || opacity > 1) {
            this.sendJson(res, 400, { error: 'opacity must be between 0 and 1' })
            return
          }
          if (blur < 0 || blur > 20) {
            this.sendJson(res, 400, { error: 'blur must be between 0 and 20' })
            return
          }

          const next: WallpaperSettings = {
            fitMode,
            opacity,
            blur,
          }
          if (wallpaperId !== undefined) next.activeWallpaperId = wallpaperId
          this.resolvedSettings = next
          this.sendJson(res, 200, { ok: true, settings: this.resolvedSettings })
        } catch (error: unknown) {
          this.sendJson(res, 500, { error: error instanceof Error ? error.message : 'Set active failed' })
        }
      },
    }))

    disposers.push(webServer.register({
      kind: 'prefix',
      path: '/api/wallpaper/',
      handler: async (req: IncomingMessage, res: ServerResponse) => {
        if (req.method !== 'DELETE') {
          res.statusCode = 405
          res.end()
          return
        }
        try {
          const url = new URL(req.url ?? '/', 'http://x')
          const pathname = url.pathname
          const idStr = pathname.slice('/api/wallpaper/'.length)
          if (idStr.length === 0) {
            this.sendJson(res, 400, { error: 'id is required' })
            return
          }
          const id = idStr as WallpaperId
          const deleted = this.store.delete(id)
          if (!deleted) {
            this.sendJson(res, 404, { error: 'Wallpaper not found' })
            return
          }
          if (this.resolvedSettings.activeWallpaperId === id) {
            this.resolvedSettings = {
              fitMode: this.resolvedSettings.fitMode,
              opacity: this.resolvedSettings.opacity,
              blur: this.resolvedSettings.blur,
            }
          }
          this.sendJson(res, 200, { ok: true })
        } catch (error: unknown) {
          this.sendJson(res, 500, { error: error instanceof Error ? error.message : 'Delete failed' })
        }
      },
    }))

    return () => {
      for (const dispose of disposers) dispose()
    }
  }

  private async parseJsonBody(req: unknown): Promise<Record<string, unknown> | undefined> {
    const request = req as { body?: unknown; on?: (event: string, cb: (chunk: unknown) => void) => void }
    if (request.body !== undefined && typeof request.body === 'object') {
      return request.body as Record<string, unknown>
    }
    return undefined
  }

  /** Validate and narrow one /api/wallpaper/generate JSON body; undefined when unusable. */
  private parseGenerateRequest(body: Record<string, unknown> | undefined): GenerateWallpaperRequest | undefined {
    if (body === undefined) return undefined
    const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : ''
    // Kind 'model' allows empty prompt if an imageUrl reference is supplied (image-to-3D).
    const imageUrl = typeof body.imageUrl === 'string' && body.imageUrl.trim().length > 0 ? body.imageUrl : undefined
    if (prompt.length === 0 && imageUrl === undefined) return undefined
    const kindIn = typeof body.kind === 'string' ? body.kind : 'image'
    const kind: WallpaperGenerateKind = kindIn === 'video'
      ? 'video'
      : kindIn === 'model'
        ? 'model'
        : 'image'
    const request: GenerateWallpaperRequest = { kind, prompt }
    if (imageUrl !== undefined) request.imageUrl = imageUrl
    const providerPool = kind === 'video'
      ? VIDEO_PROVIDERS
      : kind === 'model'
        ? MODEL_PROVIDERS
        : IMAGE_PROVIDERS
    if (typeof body.provider === 'string' && body.provider !== 'auto'
      && providerPool.includes(body.provider as MediaProvider)) {
      request.provider = body.provider
    }
    if (typeof body.size === 'string' && body.size.length > 0) request.size = body.size as ImageSize
    if (typeof body.style === 'string' && body.style.length > 0) request.style = body.style as ImageStyle
    if (typeof body.n === 'number' && Number.isInteger(body.n) && body.n >= 1 && body.n <= 4) {
      request.n = body.n
    }
    if (typeof body.duration === 'number' && body.duration >= 1 && body.duration <= 60) {
      request.duration = Math.round(body.duration)
    }
    if (typeof body.ratio === 'string' && ['16:9', '9:16', '1:1'].includes(body.ratio)) {
      request.ratio = body.ratio
    }
    const subdivisions: readonly ModelSubdivision[] = ['low', 'medium', 'high']
    if (typeof body.subdivision === 'string'
      && subdivisions.includes(body.subdivision as ModelSubdivision)) {
      request.subdivision = body.subdivision
    }
    const formats: readonly ModelFileFormat[] = ['glb', 'obj', 'usd', 'usdz']
    if (typeof body.fileFormat === 'string'
      && formats.includes(body.fileFormat as ModelFileFormat)) {
      request.fileFormat = body.fileFormat
    }
    if (typeof body.model === 'string' && body.model.length > 0) {
      request.model = body.model
    }
    return request
  }

  /**
   * Store one generated medium as a wallpaper item backed by the blob store.
   * Generated media is provider-moderated upstream, so it enters as `'passed'`.
   */
  private storeGeneratedMedia(args: {
    media: 'image' | 'video' | 'model'
    bytes: Uint8Array
    mediaType: string
    provider: string
    prompt: string
    modelFileFormat?: string
    modelSubdivision?: string
  }): WallpaperItem {
    const id = `wp_${randomUUID()}` as WallpaperId
    const tempUrl = `/api/wallpaper/temp/${id}`
    const shortPrompt = args.prompt.length > 24 ? `${args.prompt.slice(0, 24)}…` : args.prompt
    const label = args.media === 'video' ? '动态' : args.media === 'model' ? '3D' : 'AI'
    const item: WallpaperItem = {
      id,
      name: `${label} · ${shortPrompt}`,
      url: tempUrl,
      createdAt: Date.now(),
      moderationStatus: 'passed',
      source: 'generated',
      media: args.media,
      provider: args.provider,
    }
    if (args.modelFileFormat !== undefined) item.modelFileFormat = args.modelFileFormat
    if (args.modelSubdivision !== undefined) item.modelSubdivision = args.modelSubdivision
    this.store.add(item)
    this.store.setBlob(id, { data: args.bytes, mediaType: args.mediaType })
    return item
  }

  getActiveSettings(): WallpaperActiveSettings {
    return {
      activeWallpaperId: this.resolvedSettings.activeWallpaperId,
      fitMode: this.resolvedSettings.fitMode,
      opacity: this.resolvedSettings.opacity,
      blur: this.resolvedSettings.blur,
    }
  }

  getWallpaper(id: WallpaperId): WallpaperItem | undefined {
    return this.store.get(id)
  }

  listWallpapers(): WallpaperItem[] {
    return this.store.list()
  }
}

export const name = 'client-ui-wallpaper'
export const inject = ['webServer', 'llm', 'storage', 'credentials', 'settings'] as const

export interface Config {
  defaultFitMode?: WallpaperFitMode
  defaultOpacity?: number
  defaultBlur?: number
  maxFileSizeBytes?: number
}

export const Config: z<Config> = z.object({
  defaultFitMode: z.union([z.const('cover'), z.const('contain'), z.const('tile'), z.const('stretch')]).default(DEFAULT_FIT),
  defaultOpacity: z.number().min(0).max(1).default(DEFAULT_OPACITY),
  defaultBlur: z.number().min(0).max(20).default(DEFAULT_BLUR),
  maxFileSizeBytes: z.number().default(MAX_FILE_SIZE),
})

export function apply(ctx: Context, _config: Config): void {
  ctx.provide('wallpaper', new WallpaperService(ctx))
}

export default WallpaperService
