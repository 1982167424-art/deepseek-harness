/**
 * `wallpaper` namespace dictionaries.
 */

export const zh = {
  'uploadWallpaper': '上传壁纸',
  'aiModerating': 'AI 审核中...',
  'aiModerationPass': '审核通过',
  'aiModerationReject': '审核拒绝',
  'saveWallpaper': '保存壁纸',
  'setActiveWallpaper': '设为当前壁纸',
  'fitModeCover': '覆盖',
  'fitModeContain': '包含',
  'fitModeTile': '平铺',
  'fitModeStretch': '拉伸',
  'opacityLabel': '不透明度',
  'blurLabel': '模糊程度',
  'wallpaperPreview': '预览',
  'generateAiWallpaper': 'AI 生成壁纸',
  'deleteWallpaper': '删除壁纸',
  'wallpaperName': '壁纸名称',
  'settings.title': '壁纸工作室',
  'settings.uploadHint': '拖拽或点击上传 JPG/PNG 图片（最大 10MB）',
  'settings.urlHint': '或输入网络图片 URL',
  'settings.apply': '应用',
  'settings.cancel': '取消',
  'settings.urlPlaceholder': 'https://example.com/wallpaper.jpg',
  'error.uploadFailed': '上传失败',
  'error.moderationFailed': '审核失败',
  'error.invalidFormat': '仅支持 JPG 和 PNG 格式',
  'error.fileTooLarge': '文件超过 10MB 限制',
  'moderation.rejected': '拒绝',
  'moderation.passed': '通过',
} satisfies Record<string, string>

export type WallpaperKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    wallpaper: WallpaperKey
  }
}

export const en = {
  'uploadWallpaper': 'Upload Wallpaper',
  'aiModerating': 'AI moderation in progress...',
  'aiModerationPass': 'Moderation passed',
  'aiModerationReject': 'Moderation rejected',
  'saveWallpaper': 'Save Wallpaper',
  'setActiveWallpaper': 'Set as Active',
  'fitModeCover': 'Cover',
  'fitModeContain': 'Contain',
  'fitModeTile': 'Tile',
  'fitModeStretch': 'Stretch',
  'opacityLabel': 'Opacity',
  'blurLabel': 'Blur',
  'wallpaperPreview': 'Preview',
  'generateAiWallpaper': 'Generate with AI',
  'deleteWallpaper': 'Delete',
  'wallpaperName': 'Wallpaper name',
  'settings.title': 'Wallpaper Studio',
  'settings.uploadHint': 'Drag & drop or click to upload JPG/PNG (max 10MB)',
  'settings.urlHint': 'Or enter a web image URL',
  'settings.apply': 'Apply',
  'settings.cancel': 'Cancel',
  'settings.urlPlaceholder': 'https://example.com/wallpaper.jpg',
  'error.uploadFailed': 'Upload failed',
  'error.moderationFailed': 'Moderation failed',
  'error.invalidFormat': 'Only JPG and PNG formats are supported',
  'error.fileTooLarge': 'File exceeds 10MB limit',
  'moderation.rejected': 'Rejected',
  'moderation.passed': 'Passed',
} satisfies Record<WallpaperKey, string>
