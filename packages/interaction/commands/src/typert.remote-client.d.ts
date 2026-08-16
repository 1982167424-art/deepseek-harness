import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface CommandsRemote {
    execute(sessionId: SessionId, line: string): Promise<RemoteResult<unknown>>
  }
  interface TypertRemoteMap {
    'commands/execute': (args: { sessionId: SessionId; line: string }) => Promise<RemoteResult<unknown>>
  }
  interface TypertRemoteNamespaceMap {
    'commands': CommandsRemote
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
