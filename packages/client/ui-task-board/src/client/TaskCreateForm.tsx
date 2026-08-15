/**
 * The compose form: one modal collecting every field a task card accepts.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/TaskCreateForm
 */

import { useState } from 'react'
import type { TaskBoardCreateRequest, TaskKind } from '@deepseek-ai/dsh-task-board/types'
import type { Translate } from '@deepseek-ai/dsh-client-ui-slots'
import type { TaskBoardKey } from './locales.ts'
import css from './TaskBoardOverlay.module.css'

/** Props of the compose form. */
export interface TaskCreateFormProps {
  /** Typed translate for this namespace. */
  t: Translate<TaskBoardKey>
  /** Submit the composed card; the form closes on a settled result. */
  onSubmit: (request: TaskBoardCreateRequest) => void
  /** Abort composing. */
  onCancel: () => void
}

/**
 * One compose modal.
 * @param props - the copy and the two verbs.
 * @returns the form.
 */
export function TaskCreateForm({ t, onSubmit, onCancel }: TaskCreateFormProps) {
  const [kind, setKind] = useState<TaskKind>('manual')
  const [title, setTitle] = useState('')
  const [requirements, setRequirements] = useState('')
  const [acceptanceCriteria, setAcceptanceCriteria] = useState('')
  const [workspace, setWorkspace] = useState('')
  const [agentPreset, setAgentPreset] = useState('')
  const [referenceImages, setReferenceImages] = useState('')
  const [startNow, setStartNow] = useState(false)

  const submit = (): void => {
    onSubmit({
      kind,
      title,
      requirements,
      ...(acceptanceCriteria.trim().length === 0 ? {} : { acceptanceCriteria }),
      ...(workspace.trim().length === 0 ? {} : { workspace }),
      ...(agentPreset.trim().length === 0 ? {} : { agentPreset }),
      referenceImages: referenceImages
        .split('\n')
        .map(line => line.trim())
        .filter(line => line.length > 0),
      ...(startNow ? { start: true } : {}),
    })
  }

  return (
    <div className={css.modalBackdrop}>
      <form
        className={css.modal}
        onSubmit={event => {
          event.preventDefault()
          submit()
        }}
      >
        <h3 className={css.modalHeading}>{t('create.heading')}</h3>
        <label className={css.field}>
          <span>{t('field.title')}</span>
          <input
            required
            value={title}
            onChange={event => { setTitle(event.target.value) }}
            aria-label={t('field.title')}
          />
        </label>
        <label className={css.field}>
          <span>{t('field.requirements')}</span>
          <textarea
            required
            rows={3}
            value={requirements}
            onChange={event => { setRequirements(event.target.value) }}
            aria-label={t('field.requirements')}
          />
        </label>
        <label className={css.field}>
          <span>{t('field.acceptanceCriteria')}</span>
          <textarea
            rows={2}
            value={acceptanceCriteria}
            onChange={event => { setAcceptanceCriteria(event.target.value) }}
            aria-label={t('field.acceptanceCriteria')}
          />
        </label>
        <label className={css.field}>
          <span>{t('field.workspace')}</span>
          <input
            value={workspace}
            onChange={event => { setWorkspace(event.target.value) }}
            aria-label={t('field.workspace')}
          />
        </label>
        <label className={css.field}>
          <span>{t('field.agentPreset')}</span>
          <input
            value={agentPreset}
            onChange={event => { setAgentPreset(event.target.value) }}
            aria-label={t('field.agentPreset')}
          />
        </label>
        <label className={css.field}>
          <span>{t('field.referenceImages')}</span>
          <textarea
            rows={2}
            value={referenceImages}
            onChange={event => { setReferenceImages(event.target.value) }}
            aria-label={t('field.referenceImages')}
          />
        </label>
        <label className={css.fieldRow}>
          <span>{t('create.startNow')}</span>
          <input
            type="checkbox"
            checked={startNow}
            onChange={event => { setStartNow(event.target.checked) }}
          />
        </label>
        <label className={css.field}>
          <span>{t('kind.agent')}</span>
          <select
            value={kind}
            onChange={event => { setKind(event.target.value as TaskKind) }}
            aria-label={t('kind.agent')}
          >
            <option value="manual">{t('kind.manual')}</option>
            <option value="agent">{t('kind.agent')}</option>
          </select>
        </label>
        <div className={css.modalActions}>
          <button type="submit" className={css.button}>{t('create.submit')}</button>
          <button type="button" className={css.button} onClick={onCancel}>{t('create.cancel')}</button>
        </div>
      </form>
    </div>
  )
}
