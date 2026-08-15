/** Session-scoped nav panel geometry persisted via conversation location data store. */
import {
  createSnapshotStore, defineStore, type EngineStoreHandle, type SnapshotStore,
} from '@deepseek-ai/dsh-client-runtime/client'

/** The key used when publishing nav-panel geometry into the turn/session data store. */
export const NAV_LOCATION_DATA_KEY = 'conversation-nav-state'

/** Persisted shape of one session's nav panel geometry. */
export interface NavPanelState {
  /** Left offset in CSS pixels (viewport-relative). */
  x: number
  /** Top offset in CSS pixels (viewport-relative). */
  y: number
  /** Panel width in CSS pixels. */
  width: number
  /** True when collapsed to the launcher icon only. */
  minimized: boolean
  /** True when the panel shell is rendered (false hides the shell). */
  open: boolean
}

/** Default geometry for a fresh session: 320px floating strip anchored at top-left. */
export const DEFAULT_NAV_STATE: NavPanelState = {
  x: 16,
  y: 80,
  width: 320,
  minimized: false,
  open: true,
}

/** Minimum panel width for the resize handle (px). */
export const NAV_MIN_WIDTH = 220

/** Maximum panel width for the resize handle (px). */
export const NAV_MAX_WIDTH = 560

/** Declared action shape for the nav panel store (used via defineStore handle in slot registration). */
type NavPanelActions = {
  move: (draft: NavPanelState, x: number, y: number) => void
  resize: (draft: NavPanelState, width: number) => void
  toggleOpen: (draft: NavPanelState) => void
  minimize: (draft: NavPanelState) => void
  patch: (draft: NavPanelState, patch: Partial<NavPanelState>) => void
}

/**
 * Singleton store handle used to seat the slot registration's `store:` field.
 * Per-session instances are created by the framework from this handle identity.
 */
export const navStoreHandle: EngineStoreHandle<NavPanelState, NavPanelActions> = defineStore({
  init: (): NavPanelState => ({ ...DEFAULT_NAV_STATE }),
  persist: NAV_LOCATION_DATA_KEY,
  actions: {
    move: (d, x: number, y: number) => { d.x = Math.max(0, x); d.y = Math.max(0, y) },
    resize: (d, width: number) => { d.width = Math.max(NAV_MIN_WIDTH, Math.min(NAV_MAX_WIDTH, width)) },
    toggleOpen: (d) => { d.open = !d.open; if (d.open) d.minimized = false },
    minimize: (d) => { d.minimized = true },
    patch: (d, patch: Partial<NavPanelState>) => { Object.assign(d, patch) },
  },
})

/**
 * Create one transient snapshot store mirroring the session-owned location data.
 * Used for direct injection into ConversationNavPanel through the inject seat.
 */
export function createNavStore(initial?: Partial<NavPanelState>): SnapshotStore<NavPanelState> {
  return createSnapshotStore<NavPanelState>({ ...DEFAULT_NAV_STATE, ...initial })
}
