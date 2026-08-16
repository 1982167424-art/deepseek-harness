/**
 * The board overlay entry: five columns, search and kind filter, the compose
 * form, and the detail drawer. Registered into 'shell.overlay' and rendered
 * only while open, so the conversation keeps its normal chrome underneath.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/TaskBoardOverlay
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { TaskId, TaskStatus, TaskView } from '@deepseek-ai/dsh-task-board/types'
import type { TaskBoardActionResult, TaskBoardView } from './controller.ts'
import type { TaskBoardOverlayProps } from './slots.ts'
import type { TaskBoardKey } from './locales.ts'
import { ERROR_KEYS } from './locales.ts'
import { TaskCreateForm } from './TaskCreateForm.tsx'
import { TaskDetail } from './TaskDetail.tsx'
import css from './TaskBoardOverlay.module.css'

/** Every column, in board order. */
const COLUMNS: readonly TaskStatus[] = ['initialized', 'running', 'review', 'completed', 'failed']

/** Locale key for one settled action failure; unknown codes stay generic. */
export function errorKeyFor(code: string): TaskBoardKey {
  return (ERROR_KEYS as readonly string[]).includes(`error.${code}`)
    ? `error.${code}` as TaskBoardKey
    : 'error.generic'
}

/**
 * The task board overlay.
 * @param props - the injected board hook, verbs, and copy.
 * @returns the overlay while open, otherwise nothing.
 */
export function TaskBoardOverlay(props: TaskBoardOverlayProps) {
  const { useBoard, t, closeBoard, openDetail, move, create } = props
  const view = useBoard((board: TaskBoardView) => board)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'agent' | 'manual'>('all')
  const [composing, setComposing] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [dragId, setDragId] = useState<string | null>(null)

  const settle = useCallback((result: TaskBoardActionResult): void => {
    if (result.ok) setFailure(null)
    else setFailure(t(errorKeyFor(result.error.code)))
  }, [t])

  useEffect(() => {
    if (!view.open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setComposing(false)
    }
    window.addEventListener('keydown', onKey)
    return () => { window.removeEventListener('keydown', onKey) }
  }, [view.open])

  const columns = useMemo(() => {
    const needle = search.trim().toLowerCase()
    const grouped = new Map<TaskStatus, TaskView[]>(COLUMNS.map(status => [status, []]))
    for (const task of view.tasks) {
      if (kindFilter !== 'all' && task.kind !== kindFilter) continue
      if (needle.length > 0) {
        const haystack = [task.title, task.requirements, task.workspace ?? '', task.agentPreset ?? '']
        if (!haystack.some(field => field.toLowerCase().includes(needle))) continue
      }
      grouped.get(task.status)?.push(task)
    }
    return grouped
  }, [kindFilter, search, view.tasks])

  const onDrop = useCallback((event: React.DragEvent, beforeTaskId: TaskId | null): void => {
    event.preventDefault()
    event.stopPropagation()
    const dragged = dragId ?? event.dataTransfer.getData('text/plain')
    setDragId(null)
    if (dragged.length === 0 || dragged === beforeTaskId) return
    void move(dragged as TaskId, beforeTaskId).then(settle)
  }, [dragId, move, settle])

  const onOpenDetail = useCallback((id: TaskId): void => {
    void openDetail(id).then(settle)
  }, [openDetail, settle])

  const onCreate = useCallback((request: Parameters<typeof create>[0]): void => {
    void create(request).then(settle)
  }, [create, settle])

  if (!view.open) return null

  const detailTask = view.detail === null ? undefined : view.tasks.find(task => task.id === view.detail?.id)

  return (
    <div className={css.backdrop}>
      <section
        className={css.panel}
        role="dialog"
        aria-modal="true"
        aria-label={t('title')}
        onDragOver={event => event.preventDefault()}
      >
        <header className={css.header}>
          <h2 className={css.heading}>{t('title')}</h2>
          <input
            className={css.search}
            type="search"
            placeholder={t('search')}
            value={search}
            onChange={event => { setSearch(event.target.value) }}
            aria-label={t('search')}
          />
          <select
            className={css.kindSelect}
            value={kindFilter}
            onChange={event => { setKindFilter(event.target.value as 'all' | 'agent' | 'manual') }}
            aria-label={t('search')}
          >
            <option value="all">{t('kind.all')}</option>
            <option value="agent">{t('kind.agent')}</option>
            <option value="manual">{t('kind.manual')}</option>
          </select>
          <button type="button" className={css.button} onClick={() => { setComposing(true) }}>
            {t('create')}
          </button>
          <button type="button" className={css.button} onClick={() => { closeBoard() }}>
            {t('close')}
          </button>
        </header>
        {failure !== null && <p className={css.failure} role="alert">{failure}</p>}
        {view.status === 'error' && <p className={css.failure} role="alert">{t('load.failed')}</p>}
        <div className={css.columns}>
          {COLUMNS.map(status => (
            <section
              key={status}
              className={css.column}
              aria-label={t(`column.${status}`)}
              onDragOver={event => event.preventDefault()}
              onDrop={event => onDrop(event, null)}
            >
              <header className={css.columnHeader}>
                <span className={css.columnTitle}>{t(`column.${status}`)}</span>
                <span className={css.columnCount}>{columns.get(status)?.length ?? 0}</span>
              </header>
              <div className={css.columnBody}>
                {(columns.get(status)?.length ?? 0) === 0 && <p className={css.empty}>{t('column.empty')}</p>}
                {(columns.get(status) ?? []).map(task => (
                  <article
                    key={task.id}
                    className={css.card}
                    draggable
                    onDragStart={event => {
                      setDragId(task.id)
                      event.dataTransfer.setData('text/plain', task.id)
                    }}
                    onDragEnd={() => { setDragId(null) }}
                    onDragOver={event => event.preventDefault()}
                    onDrop={event => onDrop(event, task.id)}
                  >
                    <button type="button" className={css.cardOpen} onClick={() => { onOpenDetail(task.id) }}>
                      <span className={css.cardTitle}>{task.title}</span>
                      <span className={css.cardMeta}>
                        {t(task.kind === 'agent' ? 'kind.agent.short' : 'kind.manual.short')}
                        {' · '}
                        {t('card.attempts', { count: task.attempts })}
                      </span>
                    </button>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        {composing && (
          <TaskCreateForm
            t={t}
            onCancel={() => { setComposing(false) }}
            onSubmit={onCreate}
          />
        )}
        {view.detail !== null && detailTask !== undefined && (
          <TaskDetail
            t={t}
            task={detailTask}
            events={view.detail.events}
            transition={props.transition}
            remove={props.remove}
            closeDetail={props.closeDetail}
          />
        )}
      </section>
    </div>
  )
}
