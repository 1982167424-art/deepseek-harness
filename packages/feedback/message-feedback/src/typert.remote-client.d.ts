import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface MessageFeedbackRemote {
    [key: string]: (...args: never[]) => Promise<RemoteResult<unknown>>
  }
  interface TypertRemoteNamespaceMap {
    'messageFeedback': MessageFeedbackRemote
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
