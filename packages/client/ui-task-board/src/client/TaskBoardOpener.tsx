/**
 * The sidebar opener: one footer button that shows the board overlay.
 * @module @deepseek-ai/dsh-client-ui-task-board/client/TaskBoardOpener
 */

import type { TaskBoardOpenerProps } from './slots.ts'
import css from './TaskBoardOverlay.module.css'

/**
 * The footer opener button.
 * @param props - the injected board verbs and copy.
 * @returns the button.
 */
export function TaskBoardOpener({ openBoard, t }: TaskBoardOpenerProps) {
  return (
    <button type="button" className={css.opener} onClick={() => { void openBoard() }}>
      {t('open')}
    </button>
  )
}
