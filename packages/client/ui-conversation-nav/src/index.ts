/** Host half for conversation-nav: empty settings registration stub.
 *
 * The panel geometry is stored per-session through the Conversation
 * Location data store (session-scoped, key 'conversation-nav-state') so
 * the Host needs no durable section — geometry lives with the session it
 * describes and expires naturally on session deletion.
 */

import type { Context } from '@deepseek-ai/cordis'

/**
 * Host plugin body: empty (no Host-side behaviour required for the nav
 * panel). The apply exists so the plugin can be listed in the Host
 * cordis.yml alongside its client half (discovered through the
 * package.json `dsh.client` declaration).
 */
export function apply(_ctx: Context): void {}
