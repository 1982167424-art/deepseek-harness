/**
 * Wallpaper studio injected face for 'settings.general.item' slot.
 * @module @deepseek-ai/dsh-client-ui-wallpaper/client/slots
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from './locales.ts'
import type {
  GenerateWallpaperRequest, PolishWallpaperRequest,
  WallpaperActiveSettings, WallpaperId, WallpaperItem,
  WallpaperModerationResult,
} from '../types.ts'

export interface WallpaperStudioInjected {
  hooks: {
    wallpaperState: HostObservable<WallpaperStudioState>
  }
  uploadFile: (file: File) => Promise<UploadResult>
  uploadFromUrl: (url: string) => Promise<UploadResult>
  checkModeration: (id: WallpaperId) => Promise<WallpaperModerationResult>
  listWallpapers: () => Promise<WallpaperItem[]>
  setActive: (settings: Partial<WallpaperActiveSettings> & { wallpaperId?: WallpaperId }) => Promise<{ ok: boolean; settings: WallpaperActiveSettings }>
  deleteWallpaper: (id: WallpaperId) => Promise<{ ok: boolean }>
  getActiveSettings: () => WallpaperActiveSettings
  getGenerateProviders: () => Promise<GenerateProviders>
  generateWallpaper: (request: GenerateWallpaperRequest) => Promise<GenerateWallpaperResult>
  polishWallpaper: (request: PolishWallpaperRequest) => Promise<PolishWallpaperResult>
}

/** Provider kinds the host reports for each generation target. */
export interface GenerateProviders {
  image: string[]
  video: string[]
}

/** Outcome of one wallpaper generation call: created items or a named error. */
export interface GenerateWallpaperResult {
  ok: boolean
  items?: WallpaperItem[]
  error?: string
}

/** Outcome of one prompt-polish call: the rewritten prompt and its route, or a named error. */
export interface PolishWallpaperResult {
  ok: boolean
  polishedPrompt?: string
  provider?: string
  model?: string
  error?: string
}

export interface WallpaperStudioState {
  items: WallpaperItem[]
  activeSettings: WallpaperActiveSettings
  uploadStatus: 'idle' | 'uploading' | 'moderating' | 'done' | 'error'
  lastError?: string
}

export interface UploadResult {
  ok: boolean
  id?: WallpaperId
  tempUrl?: string
  moderationStatus?: 'pending' | 'passed' | 'rejected'
  error?: string
}

export type WallpaperStudioProps =
  PropsRuntime<'settings.general.item'>
  & InjectFace<WallpaperStudioInjected>
  & PropsLocale<'wallpaper'>
