/** Per-session collapse state store with persisted overrides. */
import { defineStore, type EngineStoreHandle, type SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client'

/** Collapsed node keys per turn -> boolean (true = collapsed). */
export type CollapsedNodeMap = Map<string, boolean>

/** Snapshot shape for one session's collapse state. */
export interface CollapseStoreState {
  collapsedNodes: CollapsedNodeMap
  overrides: Map<number, { reasoning?: boolean; toolCalls?: boolean }>
}

type CollapseActions = {
  setNodeCollapsed: (draft: CollapseStoreState, nodeKey: string, collapsed: boolean) => void
  setTurnCollapsed: (draft: CollapseStoreState, _turn: number, keys: readonly string[], collapsed: boolean) => void
}

/** Create one per-session collapse state store (disposed with the session scope). */
export function createCollapseStore(): EngineStoreHandle<CollapseStoreState, CollapseActions> {
  return defineStore({
    init: (): CollapseStoreState => ({ collapsedNodes: new Map(), overrides: new Map() }),
    persist: 'collapse-state',
    actions: {
      setNodeCollapsed: (d, nodeKey: string, collapsed: boolean) => {
        d.collapsedNodes = new Map(d.collapsedNodes).set(nodeKey, collapsed)
      },
      setTurnCollapsed: (d, _turn: number, keys: readonly string[], collapsed: boolean) => {
        const next = new Map(d.collapsedNodes)
        for (const key of keys) next.set(key, collapsed)
        d.collapsedNodes = next
      },
    },
  })
}

/** Helper: update a store's collapsedNodes map with a single key write. */
export function setNodeCollapsed(
  store: SnapshotStore<CollapseStoreState>,
  nodeKey: string,
  collapsed: boolean,
): void {
  store.update((draft) => {
    draft.collapsedNodes = new Map(draft.collapsedNodes).set(nodeKey, collapsed)
  })
}

/** Helper: set all nodes for a turn to collapsed (or expanded). */
export function setTurnCollapsed(
  store: SnapshotStore<CollapseStoreState>,
  _turn: number,
  keys: readonly string[],
  collapsed: boolean,
): void {
  store.update((draft) => {
    const next = new Map(draft.collapsedNodes)
    for (const key of keys) next.set(key, collapsed)
    draft.collapsedNodes = next
  })
}
