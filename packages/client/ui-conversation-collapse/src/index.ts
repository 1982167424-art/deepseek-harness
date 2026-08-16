/** Host registration for conversation-collapse preferences. */

import type { Context } from '@deepseek-ai/cordis'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import {
  COLLAPSE_SETTINGS_NAMESPACE, ConversationCollapseSettingsSchema,
} from './collapse-settings.ts'

export {
  COLLAPSE_REASONING_FIELD, COLLAPSE_SETTINGS_NAMESPACE, COLLAPSE_TOOL_CALLS_FIELD,
  ConversationCollapseSettingsSchema, DEFAULT_COLLAPSE_REASONING, DEFAULT_COLLAPSE_TOOL_CALLS,
  type ConversationCollapseSettings,
} from './collapse-settings.ts'

/**
 * Register the durable conversation-collapse section when a settings provider exists.
 * @param ctx - Host context whose optional settings service owns the section.
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      settingsNamespace(COLLAPSE_SETTINGS_NAMESPACE),
      ConversationCollapseSettingsSchema,
    )
  })
}
