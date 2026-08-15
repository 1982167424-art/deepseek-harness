/** Collapse preferences stored in the Host user-settings document. */

import z from '@deepseek-ai/schemastery'

/** Settings namespace owned by the conversation-collapse plugin. */
export const COLLAPSE_SETTINGS_NAMESPACE = 'ui-conversation-collapse'

/** Field carrying the auto-collapse toggle for reasoning blocks. */
export const COLLAPSE_REASONING_FIELD = 'collapseReasoning'

/** Field carrying the auto-collapse toggle for tool-call blocks. */
export const COLLAPSE_TOOL_CALLS_FIELD = 'collapseToolCalls'

/** Default value: auto-collapse reasoning blocks after turn completion. */
export const DEFAULT_COLLAPSE_REASONING = true

/** Default value: auto-collapse tool-call blocks after turn completion. */
export const DEFAULT_COLLAPSE_TOOL_CALLS = true

/** Durable conversation-collapse section shared by the Host schema and the browser scope. */
export interface ConversationCollapseSettings {
  /** Whether to auto-collapse reasoning blocks after a turn completes. */
  collapseReasoning: boolean
  /** Whether to auto-collapse tool-call/tool-result blocks after a turn completes. */
  collapseToolCalls: boolean
}

/** Durable conversation-collapse schema; also the wire envelope the browser scope validates against. */
export const ConversationCollapseSettingsSchema: z<ConversationCollapseSettings> = z.object({
  [COLLAPSE_REASONING_FIELD]: z.boolean().default(DEFAULT_COLLAPSE_REASONING),
  [COLLAPSE_TOOL_CALLS_FIELD]: z.boolean().default(DEFAULT_COLLAPSE_TOOL_CALLS),
})
