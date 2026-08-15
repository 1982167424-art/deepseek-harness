/**
 * Host half of the extra-themes plugin. The theme registry and preference
 * storage are owned by @deepseek-ai/dsh-client-ui-theme on both planes; this
 * package contributes only theme definitions on the Client side. The Host
 * plugin therefore has no settings to register and no webServer transforms to
 * install — it exists so the package has a Host entry point consistent with
 * every other dsh Client plugin package.
 */

import type { Context } from '@deepseek-ai/cordis'

export function apply(_ctx: Context): void {
}
