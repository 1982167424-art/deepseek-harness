/**
 * The detail drawer: every stored field, the workflow actions legal for the
 * current status, and the append-only activity log.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/TaskDetail
 */

import type { TaskAction, TaskEvent, TaskId, TaskStatus, TaskView } from '@deepseek-ai/dsh-task-board/types'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskBoardKey } from './locales.ts'
import css from './TaskBoardOverlay.module.css'

/** The actions each status offers, in display order. */
const ACTIONS = Object.freeze({
  initialized: Object.freeze(['start'] as const),
  running: Object.freeze(['stop', 'submit', 'fail'] as const),
  review: Object.freeze(['approve', 'reject'] as const),
  completed: Object.freeze(['reopen'] as const),
  failed: Object.freeze(['retry', 'reopen'] as const),
} satisfies Record<TaskStatus, readonly TaskAction[]>)

/** Props of the detail drawer. */
export interface TaskDetailProps {
  /** Typed translate for this namespace. */
  t: Translate<TaskBoardKey>
  /** The card being inspected. */
  task: TaskView
  /** The card's activity log, in sequence order. */
  events: readonly TaskEvent[]
  /** Walk the card through a workflow transition. */
  transition: (id: TaskId, action: TaskAction, note?: string) => Promise<unknown>
  /** Remove the card. */
  remove: (id: TaskId) => Promise<unknown>
  /** Close the drawer. */
  closeDetail: () => void
}

/** One HH:MM:SS local rendering of a Unix epoch millisecond timestamp. */
function clockOf(at: number): string {
  return new Date(at).toLocaleString()
}

/**
 * One detail drawer.
 * @param props - the card, its log, and the verbs.
 * @returns the drawer.
 */
export function TaskDetail({ t, task, events, transition, remove, closeDetail }: TaskDetailProps) {
  const onAction = (action: TaskAction): void => {
    void transition(task.id, action)
  }

  const onRemove = (): void => {
    if (window.confirm(t('action.remove.confirm'))) void remove(task.id)
  }

  return (
    <aside className={css.drawer} aria-label={t('detail.heading')}>
      <header className={css.drawerHeader}>
        <h3 className={css.drawerHeading}>{task.title}</h3>
        <button type="button" className={css.button} onClick={closeDetail}>{t('close')}</button>
      </header>
      <div className={css.drawerBody}>
        <dl className={css.facts}>
          <div className={css.fact}><dt>{t('field.requirements')}</dt><dd>{task.requirements}</dd></div>
          {task.acceptanceCriteria !== undefined
            && <div className={css.fact}><dt>{t('field.acceptanceCriteria')}</dt><dd>{task.acceptanceCriteria}</dd></div>}
          {task.workspace !== undefined
            && <div className={css.fact}><dt>{t('field.workspace')}</dt><dd>{task.workspace}</dd></div>}
          {task.agentPreset !== undefined
            && <div className={css.fact}><dt>{t('field.agentPreset')}</dt><dd>{task.agentPreset}</dd></div>}
          {task.referenceImages.length > 0 && (
            <div className={css.fact}>
              <dt>{t('field.referenceImages')}</dt>
              <dd><ul className={css.images}>{task.referenceImages.map(image => <li key={image}>{image}</li>)}</ul></dd>
            </div>
          )}
          <div className={css.fact}><dt>{t('detail.attempts')}</dt><dd>{task.attempts}</dd></div>
          <div className={css.fact}><dt>{t('detail.revision')}</dt><dd>{task.revision}</dd></div>
          <div className={css.fact}><dt>{t('detail.created')}</dt><dd>{clockOf(task.createdAt)}</dd></div>
          <div className={css.fact}><dt>{t('detail.updated')}</dt><dd>{clockOf(task.updatedAt)}</dd></div>
        </dl>
        <div className={css.drawerActions}>
          {ACTIONS[task.status].map(action => (
            <button key={action} type="button" className={css.button} onClick={() => { onAction(action) }}>
              {t(`action.${action}`)}
            </button>
          ))}
          <button type="button" className={css.dangerButton} onClick={onRemove}>{t('action.remove')}</button>
        </div>
        <section className={css.activity} aria-label={t('detail.activity')}>
          <h4 className={css.activityHeading}>{t('detail.activity')}</h4>
          {events.length === 0 && <p className={css.empty}>{t('detail.activity.empty')}</p>}
          <ol className={css.activityList}>
            {[...events].reverse().map(event => (
              <li key={event.seq} className={css.activityItem}>
                <span className={css.activityType}>{t(`event.${event.type}`)}</span>
                <span className={css.activityAt}>{clockOf(event.at)}</span>
                {event.note !== undefined && <span className={css.activityNote}>{event.note}</span>}
              </li>
            ))}
          </ol>
        </section>
      </div>
    </aside>
  )
}
