/**
 * Per-session model settings: the thinking toggle and the reasoning-effort
 * selector presented by the UI. The underlying wire currency remains
 * `ReasoningEffortId` (a plain string branded by dsh-llm); this module's
 * `thinkingEnabled` is a convenience boolean derived from — and written back
 * as — that same effort id. The two-field shape keeps the UI simple while
 * every provider-facing surface continues to read the single effort id.
 *
 * @module @deepseek-ai/dsh-agent-default-model/model-settings
 */

import type { ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { ReasoningEffortId as brandEffort } from '@deepseek-ai/dsh-llm'

/**
 * Session-scoped model settings owned by the reasoning UI. A missing field
 * preserves whatever behavior the adapter or provider would have applied
 * without an explicit override.
 */
export interface SessionModelSettings {
  /**
   * Whether the user wants thinking / reasoning enabled. `false` forces
   * effort `off` on the next write; `true` with no explicit effort falls
   * back to the adapter's default (typically `high` for DeepSeek). Absent
   * leaves the effective effort alone.
   */
  thinkingEnabled?: boolean
  /**
   * Adapter-owned reasoning effort id submitted as
   * {@link ReasoningEffortId}. Known ship-safe values are `off`, `high`,
   * `max` (DeepSeek) plus `low`, `medium` (OpenRouter-compat routes).
   * Absence defers to the adapter's configuration-time default.
   */
  thinkingEffortId?: string
}

/** The off/high/max triplet shared by the shipped DeepSeek adapter. */
export const KNOWN_EFFORTS = {
  OFF: 'off',
  HIGH: 'high',
  MAX: 'max',
} as const

/** Default effort applied when `thinkingEnabled=true` but no id is chosen. */
export const DEFAULT_EFFORT_WHEN_ENABLED = KNOWN_EFFORTS.HIGH

/**
 * Derive the effective reasoning effort id from session settings. Callers
 * that talk directly to `GenerateOptions` should always use the branded
 * constructor via {@link effectiveReasoningEffort}.
 * @param settings - session settings (both fields optional).
 * @returns the effective effort id string, or undefined for adapter default.
 */
export function effectiveEffortId(settings: SessionModelSettings): string | undefined {
  if (settings.thinkingEnabled === false) return KNOWN_EFFORTS.OFF
  if (settings.thinkingEffortId !== undefined) return settings.thinkingEffortId
  if (settings.thinkingEnabled === true) return DEFAULT_EFFORT_WHEN_ENABLED
  return undefined
}

/**
 * {@link effectiveEffortId} lifted into the branded
 * {@link ReasoningEffortId} type consumed by `GenerateOptions`.
 * @param settings - session settings (both fields optional).
 * @returns the branded effort id, or undefined for adapter default.
 */
export function effectiveReasoningEffort(
  settings: SessionModelSettings,
): ReasoningEffortId | undefined {
  const id = effectiveEffortId(settings)
  return id === undefined ? undefined : brandEffort(id)
}

/**
 * Reverse-derive session settings from a raw effort id. Used by UI stores
 * that subscribe to the session's current model selection and want to
 * present the two-field shape without inventing state.
 * @param effort - current reasoning effort id (or undefined).
 * @returns the two-field session settings view of the same fact.
 */
export function settingsFromEffortId(effort: string | undefined): SessionModelSettings {
  if (effort === undefined) return {}
  if (effort === KNOWN_EFFORTS.OFF) {
    return { thinkingEnabled: false, thinkingEffortId: KNOWN_EFFORTS.OFF }
  }
  return { thinkingEnabled: true, thinkingEffortId: effort }
}

/**
 * Canonical label candidates for the three standard efforts. UI packages
 * own the real copy; this table exists only for diagnostic fallbacks and
 * non-localized test surfaces.
 */
export const EFFORT_FALLBACK_LABELS: Readonly<Record<string, string>> = {
  [KNOWN_EFFORTS.OFF]: 'Off',
  [KNOWN_EFFORTS.HIGH]: 'High',
  [KNOWN_EFFORTS.MAX]: 'Max',
  low: 'Low',
  medium: 'Medium',
}
