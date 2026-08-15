import type {
  RemoteResult,
  TypertRemoteContribution,
} from '@deepseek-ai/dsh-typert-protocol'
import type { PluginInventorySnapshot } from './types.ts'

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface PluginInventoryRemote {
    list(): Promise<RemoteResult<PluginInventorySnapshot>>
  }
  interface TypertRemoteMap {
    'pluginInventory/list': () => Promise<RemoteResult<PluginInventorySnapshot>>
  }
  interface TypertRemoteNamespaceMap {
    'pluginInventory': PluginInventoryRemote
  }
}

export declare const TYPERT_REMOTE: TypertRemoteContribution
export default TYPERT_REMOTE
