/**
 * Wallpaper studio plugin, browser half: settings appearance row,
 * CSS vars registration, and the WallpaperStudio dialog.
 * @module @deepseek-ai/dsh-client-ui-wallpaper/client
 */

import type { Context } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { ClientContext, SettingsScope } from '@deepseek-ai/dsh-client-runtime/client'
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { WallpaperStudio } from './WallpaperStudio.tsx'
import type {
  GenerateProviders, GenerateWallpaperResult, PolishWallpaperResult,
  WallpaperStudioInjected, UploadResult,
} from './slots.ts'
import { en, zh, type WallpaperKey } from './locales.ts'
import type {
  GenerateWallpaperRequest, PolishWallpaperRequest,
  WallpaperActiveSettings, WallpaperId, WallpaperItem,
  WallpaperModerationResult, WallpaperSettings,
} from '../types.ts'
import {
  DEFAULT_FIT, DEFAULT_OPACITY, DEFAULT_BLUR,
  WALLPAPER_SETTINGS_NAMESPACE,
} from '../index.ts'

export type {
  WallpaperStudioInjected, UploadResult,
} from './slots.ts'
export type { WallpaperKey } from './locales.ts'
export type {
  WallpaperActiveSettings, WallpaperFitMode, WallpaperId, WallpaperItem,
  WallpaperModerationResult, WallpaperSettings,
} from '../types.ts'

export const SETTINGS_NS = 'wallpaper'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    wallpaper: WallpaperKey
  }
}

interface WallpaperStoreState {
  items: WallpaperItem[]
  activeSettings: WallpaperActiveSettings
}

type WallpaperStoreActions = {
  sync: (d: WallpaperStoreState, items: WallpaperItem[], activeSettings: WallpaperActiveSettings) => void
  setItems: (d: WallpaperStoreState, items: WallpaperItem[]) => void
  setActiveSettings: (d: WallpaperStoreState, activeSettings: WallpaperActiveSettings) => void
}

function createWallpaperStore(): EngineStoreHandle<WallpaperStoreState, WallpaperStoreActions> {
  return defineStore({
    init: (): WallpaperStoreState => ({
      items: [],
      activeSettings: {
        fitMode: DEFAULT_FIT,
        opacity: DEFAULT_OPACITY,
        blur: DEFAULT_BLUR,
      },
    }),
    actions: {
      sync: (d, items, activeSettings) => {
        d.items = items
        d.activeSettings = activeSettings
      },
      setItems: (d, items) => {
        d.items = items
      },
      setActiveSettings: (d, activeSettings) => {
        d.activeSettings = activeSettings
      },
    },
  })
}

export const inject = ['theme', 'locale', 'slots', 'runtime', 'settingsScope']

class WallpaperRuntime {
  private readonly host: SettingsScope<WallpaperSettings>

  constructor(_ctx: Context, host: SettingsScope<WallpaperSettings>) {
    this.host = host
  }

  async uploadFile(file: File): Promise<UploadResult> {
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch('/api/wallpaper/upload', {
        method: 'POST',
        body: form,
      })
      const data = await response.json() as UploadResult & { error?: string }
      if (!response.ok || data.ok === false) {
        return { ok: false, error: data.error ?? 'Upload failed' }
      }
      return data as UploadResult
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Upload failed' }
    }
  }

  async uploadFromUrl(url: string): Promise<UploadResult> {
    try {
      const response = await fetch('/api/wallpaper/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await response.json() as UploadResult & { error?: string }
      if (!response.ok || data.ok === false) {
        return { ok: false, error: data.error ?? 'Upload failed' }
      }
      return data as UploadResult
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Upload failed' }
    }
  }

  async checkModeration(id: WallpaperId): Promise<WallpaperModerationResult> {
    try {
      const response = await fetch('/api/wallpaper/moderate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wallpaperId: id }),
      })
      return await response.json() as WallpaperModerationResult
    } catch {
      return { passed: false, reason: 'Network error' }
    }
  }

  async listWallpapers(): Promise<WallpaperItem[]> {
    try {
      const response = await fetch('/api/wallpaper/list')
      const data = await response.json() as { items: WallpaperItem[]; activeSettings: WallpaperActiveSettings }
      return data.items ?? []
    } catch {
      return []
    }
  }

  async setActive(
    args: Partial<WallpaperActiveSettings> & { wallpaperId?: WallpaperId },
  ): Promise<{ ok: boolean; settings: WallpaperActiveSettings }> {
    try {
      const payload: Record<string, unknown> = {}
      if (args.wallpaperId !== undefined) payload.wallpaperId = args.wallpaperId
      if (args.fitMode !== undefined) payload.fitMode = args.fitMode
      if (args.opacity !== undefined) payload.opacity = args.opacity
      if (args.blur !== undefined) payload.blur = args.blur
      const response = await fetch('/api/wallpaper/set-active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await response.json() as { ok: boolean; settings?: WallpaperActiveSettings; error?: string }
      if (!response.ok || data.ok === false) {
        const fallback = this.host.getSnapshot().value
        let settings: WallpaperActiveSettings
        if (fallback !== undefined) {
          settings = {
            fitMode: fallback.fitMode,
            opacity: fallback.opacity,
            blur: fallback.blur,
          }
          if (fallback.activeWallpaperId !== undefined) {
            settings.activeWallpaperId = fallback.activeWallpaperId
          }
        } else {
          settings = {
            fitMode: DEFAULT_FIT,
            opacity: DEFAULT_OPACITY,
            blur: DEFAULT_BLUR,
          }
        }
        return { ok: false, settings }
      }
      return { ok: true, settings: data.settings ?? payload as unknown as WallpaperActiveSettings }
    } catch {
      return {
        ok: false,
        settings: {
          fitMode: DEFAULT_FIT,
          opacity: DEFAULT_OPACITY,
          blur: DEFAULT_BLUR,
        },
      }
    }
  }

  async deleteWallpaper(id: WallpaperId): Promise<{ ok: boolean }> {
    try {
      const response = await fetch(`/api/wallpaper/${id}`, {
        method: 'DELETE',
      })
      return response.ok ? { ok: true } : { ok: false }
    } catch {
      return { ok: false }
    }
  }

  getActiveSettings(): WallpaperActiveSettings {
    const section = this.host.getSnapshot().value
    if (section === undefined) {
      return {
        fitMode: DEFAULT_FIT,
        opacity: DEFAULT_OPACITY,
        blur: DEFAULT_BLUR,
      }
    }
    const result: WallpaperActiveSettings = {
      fitMode: section.fitMode,
      opacity: section.opacity,
      blur: section.blur,
    }
    if (section.activeWallpaperId !== undefined) {
      result.activeWallpaperId = section.activeWallpaperId
    }
    return result
  }

  async getGenerateProviders(): Promise<GenerateProviders> {
    try {
      const response = await fetch('/api/wallpaper/providers')
      if (!response.ok) return { image: [], video: [] }
      const data = await response.json() as Partial<GenerateProviders>
      return {
        image: Array.isArray(data.image) ? data.image : [],
        video: Array.isArray(data.video) ? data.video : [],
      }
    } catch {
      return { image: [], video: [] }
    }
  }

  async generateWallpaper(request: GenerateWallpaperRequest): Promise<GenerateWallpaperResult> {
    try {
      const response = await fetch('/api/wallpaper/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const data = await response.json() as GenerateWallpaperResult
      if (!response.ok) {
        return { ok: false, error: data.error ?? 'Generate failed' }
      }
      return { ok: true, items: data.items ?? [] }
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Generate failed' }
    }
  }

  async polishWallpaper(request: PolishWallpaperRequest): Promise<PolishWallpaperResult> {
    try {
      const response = await fetch('/api/wallpaper/polish', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
      })
      const data = await response.json() as PolishWallpaperResult
      if (!response.ok || typeof data.polishedPrompt !== 'string') {
        return { ok: false, error: data.error ?? 'Polish failed' }
      }
      const out: PolishWallpaperResult = { ok: true, polishedPrompt: data.polishedPrompt }
      if (data.provider !== undefined) out.provider = data.provider
      if (data.model !== undefined) out.model = data.model
      return out
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : 'Polish failed' }
    }
  }
}

export function apply(ctx: ClientContext): void {
  const host = ctx.settingsScope.bind<WallpaperSettings>({
    namespace: WALLPAPER_SETTINGS_NAMESPACE,
  })
  const runtime = new WallpaperRuntime(ctx, host)

  ctx.effect(() => ctx.locale.register(SETTINGS_NS, { zh, en }), 'ui-wallpaper: dictionaries')

  const store = createWallpaperStore()

  const injected = (actions: BoundActions<typeof store>): WallpaperStudioInjected => ({
    hooks: {
      wallpaperState: store as unknown as WallpaperStudioInjected['hooks']['wallpaperState'],
    },
    uploadFile: f => runtime.uploadFile(f),
    uploadFromUrl: url => runtime.uploadFromUrl(url),
    checkModeration: id => runtime.checkModeration(id),
    listWallpapers: async () => {
      const list = await runtime.listWallpapers()
      actions.setItems(list)
      return list
    },
    setActive: async s => {
      const result = await runtime.setActive(s)
      if (result.ok) actions.setActiveSettings(result.settings)
      return result
    },
    deleteWallpaper: async id => runtime.deleteWallpaper(id),
    getActiveSettings: () => runtime.getActiveSettings(),
    getGenerateProviders: () => runtime.getGenerateProviders(),
    generateWallpaper: async request => {
      const result = await runtime.generateWallpaper(request)
      if (result.ok) {
        const list = await runtime.listWallpapers()
        actions.setItems(list)
      }
      return result
    },
    polishWallpaper: request => runtime.polishWallpaper(request),
  })

  ctx.effect(() => {
    if (typeof document === 'undefined') return () => {}
    const root = document.documentElement
    root.style.setProperty('--wallpaper-url', 'none')
    root.style.setProperty('--wallpaper-opacity', String(DEFAULT_OPACITY))
    root.style.setProperty('--wallpaper-blur', '0px')
    root.style.setProperty('--wallpaper-fit', DEFAULT_FIT)
    return () => {
      root.style.removeProperty('--wallpaper-url')
      root.style.removeProperty('--wallpaper-opacity')
      root.style.removeProperty('--wallpaper-blur')
      root.style.removeProperty('--wallpaper-fit')
    }
  }, 'ui-wallpaper: css vars registration')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'wallpaper-studio',
    order: 20,
    store,
    locale: SETTINGS_NS,
    inject: injected,
  } as any, WallpaperStudio as any))
}
