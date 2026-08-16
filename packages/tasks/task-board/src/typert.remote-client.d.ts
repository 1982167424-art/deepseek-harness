import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type {
  TaskBoardExecuteRequest,
  TaskBoardExecuteResult,
} from '@deepseek-ai/dsh-task-board/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  /**
   * Single-tool Remote namespace following CodeGraph's pattern: one
   * `execute` entry instead of seven narrow methods. Callers dispatch via
   * the `op` discriminant on the request; the widened result carries the
   * same business-failure vocabulary so client branching is unchanged.
   */
  interface TaskBoardRemote {
    execute(request: TaskBoardExecuteRequest): Promise<RemoteResult<TaskBoardExecuteResult>>
  }
  interface TypertRemoteMap {
    'taskBoard/execute': (request: TaskBoardExecuteRequest) => Promise<RemoteResult<TaskBoardExecuteResult>>
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
