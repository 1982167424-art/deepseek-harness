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
import z from '@deepseek-ai/schemastery'
import { installSettingsSection, settingsNamespace } from '@deepseek-ai/dsh-settings'
import type {
  ListWallpapersResponse, UploadWallpaperResponse,
  WallpaperActiveSettings, WallpaperFitMode, WallpaperId, WallpaperItem,
  WallpaperModerationResult, WallpaperSettings,
} from './types.ts'
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

export const DEFAULT_FIT: WallpaperFitMode = 'cover'
export const DEFAULT_OPACITY = 0.85
export const DEFAULT_BLUR = 0
const MAX_FILE_SIZE = 10 * 1024 * 1024
const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png'])

class WallpaperStore {
  private readonly items = new Map<WallpaperId, WallpaperItem>()
  private readonly order: WallpaperId[] = []

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
