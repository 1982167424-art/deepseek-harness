/**
 * Public types for the ui-wallpaper package.
 * @module @deepseek-ai/dsh-client-ui-wallpaper/types
 */

import type { Branded } from '@deepseek-ai/dsh-brand'

export type WallpaperId = string & Branded<'WallpaperId'>

export type WallpaperFitMode = 'cover' | 'contain' | 'tile' | 'stretch'

export type WallpaperModerationStatus = 'pending' | 'passed' | 'rejected'

export interface WallpaperItem {
  id: WallpaperId
  name: string
  url: string
  thumbnail?: string | undefined
  createdAt: number
  moderationStatus: WallpaperModerationStatus
  moderationReason?: string | undefined
  moderationCategories?: string[] | undefined
  source: 'upload' | 'url' | 'generated'
  /** Stored medium kind; generated videos carry `'video'`. */
  media?: 'image' | 'video' | undefined
  /** Provider that produced a generated wallpaper, e.g. `'volcengine'`. */
  provider?: string | undefined
}

export interface WallpaperModerationResult {
  passed: boolean
  reason?: string | undefined
  categories?: string[] | undefined
}

export interface WallpaperActiveSettings {
  activeWallpaperId?: WallpaperId | undefined
  fitMode: WallpaperFitMode
  opacity: number
  blur: number
}

export interface WallpaperSettings {
  activeWallpaperId?: WallpaperId | undefined
  fitMode: WallpaperFitMode
  opacity: number
  blur: number
}

export interface UploadWallpaperResponse {
  id: WallpaperId
  tempUrl: string
  moderationStatus: WallpaperModerationStatus
}

export interface ListWallpapersResponse {
  items: WallpaperItem[]
  activeSettings: WallpaperActiveSettings
}

/** Generation target kinds the wallpaper generate API accepts. */
export type WallpaperGenerateKind = 'image' | 'video'

/** One wallpaper generation request; optional fields apply per `kind`. */
export interface GenerateWallpaperRequest {
  kind: WallpaperGenerateKind
  prompt: string
  provider?: string | undefined
  size?: string | undefined
  style?: string | undefined
  n?: number | undefined
  duration?: number | undefined
  ratio?: string | undefined
}

/** Wallpapers created by one generation request, already stored in the library. */
export interface GenerateWallpaperResponse {
  items: WallpaperItem[]
}

/** One prompt-polish request: the rough idea and the generation it will feed. */
export interface PolishWallpaperRequest {
  idea: string
  target: WallpaperGenerateKind
}

/** Polished prompt text plus the provider/model that produced it. */
export interface PolishWallpaperResponse {
  polishedPrompt: string
  provider: string
  model: string
}
