/**
 * Wallpaper studio dialog: upload, grid view, fit/opactiy/blur controls,
 * live preview, and AI moderation status.
 * @module @deepseek-ai/dsh-client-ui-wallpaper/client/WallpaperStudio
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { HostObservable } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  WallpaperFitMode, WallpaperGenerateKind, WallpaperId, WallpaperItem, WallpaperActiveSettings,
} from '../types.ts'
import type { GenerateProviders, WallpaperStudioProps, UploadResult } from './slots.ts'
import type { WallpaperKey } from './locales.ts'
import css from './WallpaperStudio.module.css'

const FIT_MODES: { value: WallpaperFitMode; labelKey: WallpaperKey }[] = [
  { value: 'cover', labelKey: 'fitModeCover' },
  { value: 'contain', labelKey: 'fitModeContain' },
  { value: 'tile', labelKey: 'fitModeTile' },
  { value: 'stretch', labelKey: 'fitModeStretch' },
]

function fitCssValue(mode: WallpaperFitMode): string {
  switch (mode) {
    case 'cover': return 'cover'
    case 'contain': return 'contain'
    case 'tile': return 'auto'
    case 'stretch': return '100% 100%'
  }
}

function repeatValue(mode: WallpaperFitMode): string {
  return mode === 'tile' ? 'repeat' : 'no-repeat'
}

export function WallpaperStudio({
  uploadFile, uploadFromUrl, checkModeration, listWallpapers,
  setActive, deleteWallpaper, getActiveSettings,
  getGenerateProviders, generateWallpaper, polishWallpaper, t,
}: WallpaperStudioProps & { wallpaperState?: HostObservable<unknown> }) {
  const [items, setItems] = useState<WallpaperItem[]>([])
  const [activeSettings, setActiveSettings] = useState<WallpaperActiveSettings>(() => ({
    fitMode: 'cover',
    opacity: 0.85,
    blur: 0,
  }))
  const [previewUrl, setPreviewUrl] = useState<string | undefined>()
  const [previewIsVideo, setPreviewIsVideo] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'uploading' | 'moderating' | 'error'>('idle')
  const [uploadError, setUploadError] = useState<string | undefined>()
  const [urlInput, setUrlInput] = useState('')
  const [selectedId, setSelectedId] = useState<WallpaperId | undefined>()
  const [isDragging, setIsDragging] = useState(false)
  const [genKind, setGenKind] = useState<WallpaperGenerateKind>('image')
  const [genIdea, setGenIdea] = useState('')
  const [genPrompt, setGenPrompt] = useState('')
  const [genProvider, setGenProvider] = useState('auto')
  const [providers, setProviders] = useState<GenerateProviders>({ image: [], video: [] })
  const [polishing, setPolishing] = useState(false)
  const [polished, setPolished] = useState<{ prompt: string; provider: string; model: string } | undefined>()
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | undefined>()
  const fileInputRef = useRef<HTMLInputElement>(null)
  const pollingTimers = useRef(new Map<WallpaperId, number>())

  const refresh = useCallback(async () => {
    try {
      const list = await listWallpapers()
      setItems(list)
    } catch {
      // ignore
    }
  }, [listWallpapers])

  useEffect(() => {
    void refresh()
    setActiveSettings(getActiveSettings())
    void getGenerateProviders().then(setProviders)
    return () => {
      for (const timer of pollingTimers.current.values()) {
        window.clearTimeout(timer)
      }
      pollingTimers.current.clear()
    }
  }, [refresh, getActiveSettings, getGenerateProviders])

  useEffect(() => {
    if (selectedId !== undefined) {
      const item = items.find(i => i.id === selectedId)
      if (item !== undefined) {
        setPreviewUrl(item.url)
        setPreviewIsVideo(item.media === 'video')
      }
    }
  }, [selectedId, items])

  const pollModeration = useCallback((id: WallpaperId, retries = 0) => {
    const maxRetries = 10
    if (retries >= maxRetries) {
      void refresh()
      return
    }
    const timer = window.setTimeout(async () => {
      try {
        const result = await checkModeration(id)
        if (result.passed || result.reason !== undefined) {
          void refresh()
          setUploadStatus('idle')
        } else {
          pollModeration(id, retries + 1)
        }
      } catch {
        void refresh()
      }
    }, 1500)
    pollingTimers.current.set(id, timer)
  }, [checkModeration, refresh])

  const handleUploadResult = useCallback((result: UploadResult) => {
    if (!result.ok) {
      setUploadStatus('error')
      setUploadError(result.error ?? t('error.uploadFailed'))
      return
    }
    if (result.moderationStatus === 'pending') {
      setUploadStatus('moderating')
      if (result.id !== undefined) pollModeration(result.id)
    } else {
      setUploadStatus('idle')
      void refresh()
    }
  }, [refresh, pollModeration, t])

  const onFileSelected = useCallback(async (files: FileList | null) => {
    if (files === null || files.length === 0) return
    const file = files[0]
    if (file === undefined) return
    if (!ALLOWED_MIME.has(file.type) && !/(\.jpg|\.jpeg|\.png)$/i.test(file.name)) {
      setUploadStatus('error')
      setUploadError(t('error.invalidFormat'))
      return
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadStatus('error')
      setUploadError(t('error.fileTooLarge'))
      return
    }
    setUploadStatus('uploading')
    setUploadError(undefined)
    try {
      const result = await uploadFile(file)
      handleUploadResult(result)
    } catch (error: unknown) {
      setUploadStatus('error')
      setUploadError(error instanceof Error ? error.message : t('error.uploadFailed'))
    }
  }, [uploadFile, handleUploadResult, t])

  const onUrlUpload = useCallback(async () => {
    const url = urlInput.trim()
    if (url.length === 0) return
    if (!/\.jpe?g(?:[?#]|$)/i.test(url) && !/\.png(?:[?#]|$)/i.test(url)) {
      setUploadStatus('error')
      setUploadError(t('error.urlInvalid'))
      return
    }
    setUploadStatus('uploading')
    setUploadError(undefined)
    try {
      const result = await uploadFromUrl(url)
      handleUploadResult(result)
      setUrlInput('')
    } catch (error: unknown) {
      setUploadStatus('error')
      setUploadError(error instanceof Error ? error.message : t('error.uploadFailed'))
    }
  }, [urlInput, uploadFromUrl, handleUploadResult, t])

  const onPolish = useCallback(async () => {
    const idea = genIdea.trim()
    if (idea.length === 0 || polishing) return
    setPolishing(true)
    setGenError(undefined)
    try {
      const result = await polishWallpaper({ idea, target: genKind })
      if (!result.ok || result.polishedPrompt === undefined) {
        setGenError(result.error ?? t('error.polishFailed'))
        return
      }
      setPolished({
        prompt: result.polishedPrompt,
        provider: result.provider ?? '',
        model: result.model ?? '',
      })
    } catch (error: unknown) {
      setGenError(error instanceof Error ? error.message : t('error.polishFailed'))
    } finally {
      setPolishing(false)
    }
  }, [genIdea, genKind, polishing, polishWallpaper, t])

  const onGenerate = useCallback(async () => {
    const prompt = genPrompt.trim()
    if (prompt.length === 0 || generating) return
    setGenerating(true)
    setGenError(undefined)
    try {
      const result = await generateWallpaper({
        kind: genKind,
        prompt,
        provider: genProvider,
      })
      if (!result.ok) {
        setGenError(result.error ?? t('error.generateFailed'))
        return
      }
      const created = result.items ?? []
      if (created.length > 0) {
        setSelectedId(created[0]?.id)
        setPreviewUrl(created[0]?.url)
        setPreviewIsVideo(created[0]?.media === 'video')
      }
      void refresh()
    } catch (error: unknown) {
      setGenError(error instanceof Error ? error.message : t('error.generateFailed'))
    } finally {
      setGenerating(false)
    }
  }, [genPrompt, generating, genKind, genProvider, generateWallpaper, refresh, t])

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(true)
  }, [])

  const onDragLeave = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
  }, [])

  const onDrop = useCallback((event: React.DragEvent) => {
    event.preventDefault()
    setIsDragging(false)
    onFileSelected(event.dataTransfer.files)
  }, [onFileSelected])

  const localApply = useCallback(async () => {
    const wallpaperId = selectedId ?? activeSettings.activeWallpaperId
    const args: Partial<WallpaperActiveSettings> & { wallpaperId?: WallpaperId } = {
      fitMode: activeSettings.fitMode,
      opacity: activeSettings.opacity,
      blur: activeSettings.blur,
    }
    if (wallpaperId !== undefined) args.wallpaperId = wallpaperId
    const result = await setActive(args)
    if (result.ok) {
      setActiveSettings(result.settings)
      applyCssVars(result.settings, previewUrl)
    }
  }, [selectedId, activeSettings, setActive, previewUrl])

  const onDelete = useCallback(async (id: WallpaperId) => {
    await deleteWallpaper(id)
    if (selectedId === id) {
      setSelectedId(undefined)
      setPreviewUrl(undefined)
    }
    void refresh()
  }, [selectedId, deleteWallpaper, refresh])

  return (
    <div className={css.studio}>
      <h3 className={css.title}>{t('settings.title')}</h3>

      <div
        className={`${css.dropzone} ${isDragging ? css.dragging : ''}`}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg,.png,image/jpeg,image/png"
          className={css.hiddenInput}
          onChange={e => { onFileSelected(e.target.files) }}
        />
        <span>{t('settings.uploadHint')}</span>
        {uploadStatus === 'uploading' && <span className={css.status}>...{t('uploadWallpaper')}</span>}
        {uploadStatus === 'moderating' && <span className={css.status}>{t('aiModerating')}</span>}
        {uploadStatus === 'error' && uploadError !== undefined && (
          <span className={css.error}>{uploadError}</span>
        )}
      </div>

      <div className={css.urlRow}>
        <input
          type="text"
          className={css.urlInput}
          placeholder={t('settings.urlPlaceholder')}
          value={urlInput}
          onChange={e => { setUrlInput(e.target.value) }}
        />
        <button type="button" className={css.button} onClick={onUrlUpload}>
          {t('uploadWallpaper')}
        </button>
      </div>

      <div className={css.generatePanel}>
        <div className={css.generateHeader}>
          <span className={css.generateTitle}>{t('generate.title')}</span>
          <div className={css.kindToggle}>
            <button
              type="button"
              className={`${css.kindBtn} ${genKind === 'image' ? css.kindBtnActive : ''}`}
              onClick={() => { setGenKind('image'); setGenProvider('auto') }}
            >
              {t('generate.kindImage')}
            </button>
            <button
              type="button"
              className={`${css.kindBtn} ${genKind === 'video' ? css.kindBtnActive : ''}`}
              onClick={() => { setGenKind('video'); setGenProvider('auto') }}
            >
              {t('generate.kindVideo')}
            </button>
          </div>
        </div>

        <div className={css.genRow}>
          <label className={css.label}>{t('generate.ideaLabel')}</label>
          <div className={css.ideaRow}>
            <input
              type="text"
              className={css.urlInput}
              placeholder={t('generate.ideaPlaceholder')}
              value={genIdea}
              onChange={e => { setGenIdea(e.target.value) }}
            />
            <button
              type="button"
              className={css.button}
              disabled={polishing || genIdea.trim().length === 0}
              onClick={() => { void onPolish() }}
            >
              {polishing ? t('generate.polishing') : t('generate.polish')}
            </button>
          </div>
        </div>

        {polished !== undefined && (
          <div className={css.polishResult}>
            <div className={css.polishMeta}>
              {t('generate.polishedBy')}: {polished.provider}/{polished.model}
            </div>
            <p className={css.polishText}>{polished.prompt}</p>
            <div className={css.polishActions}>
              <button
                type="button"
                className={css.primaryBtn}
                onClick={() => {
                  setGenPrompt(polished.prompt)
                  setPolished(undefined)
                }}
              >
                {t('generate.usePolished')}
              </button>
              <button
                type="button"
                className={css.button}
                disabled={polishing}
                onClick={() => { void onPolish() }}
              >
                {t('generate.polishAgain')}
              </button>
            </div>
            <p className={css.polishNotice}>{t('generate.polishNotice')}</p>
          </div>
        )}

        <div className={css.genRow}>
          <label className={css.label}>{t('generate.promptLabel')}</label>
          <textarea
            className={css.promptInput}
            placeholder={t('generate.promptPlaceholder')}
            value={genPrompt}
            onChange={e => { setGenPrompt(e.target.value) }}
          />
        </div>

        <div className={css.genRow}>
          <label className={css.label}>{t('generate.providerLabel')}</label>
          <select
            className={css.select}
            value={genProvider}
            onChange={e => { setGenProvider(e.target.value) }}
          >
            <option value="auto">{t('generate.providerAuto')}</option>
            {(genKind === 'video' ? providers.video : providers.image).map(provider => (
              <option key={provider} value={provider}>{provider}</option>
            ))}
          </select>
        </div>

        {genError !== undefined && <span className={css.error}>{genError}</span>}

        <button
          type="button"
          className={css.primaryBtn}
          disabled={generating || genPrompt.trim().length === 0}
          onClick={() => { void onGenerate() }}
        >
          {generating ? t('generate.generating') : t('generate.submit')}
        </button>
      </div>

      <div className={css.grid}>
        {items.map(item => (
          <div
            key={item.id}
            className={`${css.thumbnail} ${selectedId === item.id ? css.selected : ''}`}
            onClick={() => {
              setSelectedId(item.id)
              setPreviewUrl(item.url)
            }}
          >
            {item.media === 'video'
              ? <video className={css.thumbVideo} src={item.url} muted loop playsInline preload="metadata" />
              : <div className={css.thumbImage} style={{ backgroundImage: `url(${item.url})` }} />}
            <div className={css.thumbInfo}>
              <span className={css.thumbName}>{item.name}</span>
              {item.media === 'video' && <span className={`${css.badge}`}>{t('grid.videoBadge')}</span>}
              {item.source === 'generated' && <span className={css.badge}>{t('grid.generatedBadge')}</span>}
              {item.moderationStatus === 'passed' && (
                <span className={`${css.badge} ${css.badgePassed}`}>
                  {t('moderation.passed')}
                </span>
              )}
              {item.moderationStatus === 'rejected' && (
                <span className={`${css.badge} ${css.badgeRejected}`} title={item.moderationReason}>
                  {t('moderation.rejected')}
                </span>
              )}
              {item.moderationStatus === 'pending' && (
                <span className={css.badge}>{t('aiModerating')}</span>
              )}
            </div>
            <button
              type="button"
              className={css.deleteBtn}
              onClick={e => { e.stopPropagation(); void onDelete(item.id) }}
            >
              ×
            </button>
            {activeSettings.activeWallpaperId === item.id && (
              <div className={css.activeMark}>✓</div>
            )}
          </div>
        ))}
      </div>

      <div className={css.controls}>
        <div className={css.controlRow}>
          <label className={css.label}>{t('fitModeCover').replace('覆盖', '适配模式')}</label>
          <select
            className={css.select}
            value={activeSettings.fitMode}
            onChange={e => {
              setActiveSettings(s => ({ ...s, fitMode: e.target.value as WallpaperFitMode }))
            }}
          >
            {FIT_MODES.map(mode => (
              <option key={mode.value} value={mode.value}>{t(mode.labelKey)}</option>
            ))}
          </select>
        </div>

        <div className={css.controlRow}>
          <label className={css.label}>
            {t('opacityLabel')}: {Math.round(activeSettings.opacity * 100)}%
          </label>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(activeSettings.opacity * 100)}
            onChange={e => {
              setActiveSettings(s => ({ ...s, opacity: Number(e.target.value) / 100 }))
            }}
            className={css.slider}
          />
        </div>

        <div className={css.controlRow}>
          <label className={css.label}>
            {t('blurLabel')}: {activeSettings.blur}px
          </label>
          <input
            type="range"
            min={0}
            max={20}
            step={1}
            value={activeSettings.blur}
            onChange={e => {
              setActiveSettings(s => ({ ...s, blur: Number(e.target.value) }))
            }}
            className={css.slider}
          />
        </div>
      </div>

      <div className={css.previewSection}>
        <div className={css.previewLabel}>{t('wallpaperPreview')}</div>
        {previewIsVideo && previewUrl !== undefined
          ? (
            <video
              className={css.previewVideo}
              src={previewUrl}
              autoPlay
              muted
              loop
              playsInline
              style={{
                opacity: activeSettings.opacity,
                filter: `blur(${activeSettings.blur}px)`,
              }}
            />
            )
          : (
            <div
              className={css.preview}
              style={{
                backgroundImage: previewUrl !== undefined ? `url(${previewUrl})` : undefined,
                backgroundSize: fitCssValue(activeSettings.fitMode),
                backgroundRepeat: repeatValue(activeSettings.fitMode),
                opacity: activeSettings.opacity,
                filter: `blur(${activeSettings.blur}px)`,
              }}
            />
            )}
      </div>

      <div className={css.actions}>
        <button type="button" className={css.primaryBtn} onClick={localApply}>
          {t('settings.apply')}
        </button>
      </div>
    </div>
  )
}

const ALLOWED_MIME = new Set(['image/jpeg', 'image/jpg', 'image/png'])

function applyCssVars(settings: WallpaperActiveSettings, previewUrl: string | undefined): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  if (previewUrl !== undefined) {
    root.style.setProperty('--wallpaper-url', `url(${previewUrl})`)
  }
  root.style.setProperty('--wallpaper-opacity', String(settings.opacity))
  root.style.setProperty('--wallpaper-blur', `${settings.blur}px`)
  root.style.setProperty('--wallpaper-fit', settings.fitMode)
}
