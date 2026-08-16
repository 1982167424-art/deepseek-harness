/**
 * The board entries' injected face. Both seats ('shell.overlay' for the
 * board, 'sidebar.footer.action' for the opener button) are declared by
 * their owner packages; this package only contributes entries, so no SlotMap
 * merge lives here. Live board state arrives through the `board` hook (the
 * framework standard kit binds it into `useBoard`).
 * @module @deepseek-ai/dsh-client-ui-task-board/client/slots
 */

import type {
  HostObservable, InjectFace, PropsLocale, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the ui-layout SlotMap merge (the shell.overlay seat).
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
// Type-only: pulls the ui-sidebar SlotMap merge (the footer action seat).
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {
  TaskAction,
  TaskBoardCreateRequest,
  TaskId,
} from '@deepseek-ai/dsh-task-board/types'
// Type-only: pulls this package's LocaleNamespaceMap merge (the 'taskBoard' seat).
import type {} from './locales.ts'
import type { TaskBoardActionResult, TaskBoardView } from './controller.ts'

/** The edit fields the compose and detail forms may change. */
export interface TaskBoardEditFields {
  readonly title?: string
  readonly requirements?: string
  readonly acceptanceCriteria?: string | null
  readonly workspace?: string | null
  readonly agentPreset?: string | null
}

/** Injected business face of the task board entries. */
export interface TaskBoardInjected {
  hooks: {
    /** The board mirror, shared by the overlay, the drawer, and the opener. */
    board: HostObservable<TaskBoardView>
  }
  /** Show the board, loading it first when it is still cold. */
  openBoard: () => Promise<TaskBoardActionResult>
  /** Hide the board and the detail drawer. */
  closeBoard: () => void
  /** Open the detail drawer for one task, fetching its activity log. */
  openDetail: (id: TaskId) => Promise<TaskBoardActionResult>
  /** Close the detail drawer. */
  closeDetail: () => void
  /** Create one card from the compose form. */
  create: (request: TaskBoardCreateRequest) => Promise<TaskBoardActionResult>
  /** Edit the descriptive fields of one card. */
  update: (id: TaskId, fields: TaskBoardEditFields) => Promise<TaskBoardActionResult>
  /** Walk one card through a workflow transition. */
  transition: (id: TaskId, action: TaskAction, note?: string) => Promise<TaskBoardActionResult>
  /** Reorder one card inside its column. */
  move: (id: TaskId, beforeTaskId: TaskId | null) => Promise<TaskBoardActionResult>
  /** Remove one card. */
  remove: (id: TaskId) => Promise<TaskBoardActionResult>
}

/** Full props of the board overlay entry. */
export type TaskBoardOverlayProps =
  PropsRuntime<'shell.overlay'>
  & InjectFace<TaskBoardInjected>
  & PropsLocale<'taskBoard'>

/** Full props of the sidebar opener entry. */
export type TaskBoardOpenerProps =
  PropsRuntime<'sidebar.footer.action'>
  & InjectFace<TaskBoardInjected>
  & PropsLocale<'taskBoard'>
