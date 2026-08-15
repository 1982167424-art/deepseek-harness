import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskBoardCreateRequest,
  TaskBoardCreateResult,
  TaskBoardGetRequest,
  TaskBoardGetResult,
  TaskBoardListResult,
  TaskBoardMoveRequest,
  TaskBoardMoveResult,
  TaskBoardRemoveRequest,
  TaskBoardRemoveResult,
  TaskBoardTransitionRequest,
  TaskBoardTransitionResult,
  TaskBoardUpdateRequest,
  TaskBoardUpdateResult,
} from '@deepseek-ai/dsh-task-board/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface TaskBoardRemote {
    list(): Promise<RemoteResult<TaskBoardListResult>>
    get(request: TaskBoardGetRequest): Promise<RemoteResult<TaskBoardGetResult>>
    create(request: TaskBoardCreateRequest): Promise<RemoteResult<TaskBoardCreateResult>>
    update(request: TaskBoardUpdateRequest): Promise<RemoteResult<TaskBoardUpdateResult>>
    transition(request: TaskBoardTransitionRequest): Promise<RemoteResult<TaskBoardTransitionResult>>
    move(request: TaskBoardMoveRequest): Promise<RemoteResult<TaskBoardMoveResult>>
    remove(request: TaskBoardRemoveRequest): Promise<RemoteResult<TaskBoardRemoveResult>>
  }
  interface TypertRemoteMap {
    'taskBoard/list': () => Promise<RemoteResult<TaskBoardListResult>>
    'taskBoard/get': (request: TaskBoardGetRequest) => Promise<RemoteResult<TaskBoardGetResult>>
    'taskBoard/create': (request: TaskBoardCreateRequest) => Promise<RemoteResult<TaskBoardCreateResult>>
    'taskBoard/update': (request: TaskBoardUpdateRequest) => Promise<RemoteResult<TaskBoardUpdateResult>>
    'taskBoard/transition': (request: TaskBoardTransitionRequest) => Promise<RemoteResult<TaskBoardTransitionResult>>
    'taskBoard/move': (request: TaskBoardMoveRequest) => Promise<RemoteResult<TaskBoardMoveResult>>
    'taskBoard/remove': (request: TaskBoardRemoveRequest) => Promise<RemoteResult<TaskBoardRemoveResult>>
  }
  interface TypertRemoteNamespaceMap {
    'taskBoard': TaskBoardRemote
  }
}

/**
 * The taskBoard Remote contribution this package publishes; the build's
 * generator emits the equivalent typed face into `lib/typert.remote-client.d.ts`.
 */
export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
