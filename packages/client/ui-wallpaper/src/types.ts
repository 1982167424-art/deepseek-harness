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
