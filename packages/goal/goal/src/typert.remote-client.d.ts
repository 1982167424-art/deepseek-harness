import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface GoalsRemote {
    [key: string]: (...args: never[]) => Promise<RemoteResult<unknown>>
  }
  interface TypertRemoteNamespaceMap {
    'goals': GoalsRemote
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
