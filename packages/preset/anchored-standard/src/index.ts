/**
 * Anchored-Standard experimental agent preset bundle.
 *
 * Ships three preset composition directories under this package's `src/`
 * layout; callers mount them through the `@deepseek-ai/dsh-agent-presets`
 * roster roots configuration by pointing `path` at the package directory or
 * individual preset subdirectories below:
 *
 *  - `src/preset/` — the default `anchored-standard` preset: Minimal
 *    bootstrap tool pair (persistent `bash` + `str_replace_editor`) with
 *    suppressed context on request #1, promoted to the resident discovery
 *    catalog after the first durable promotion signal.
 *  - `src/zero-anchored-standard/` — zero-tool anchor turn: the first
 *    top-level request carries an empty tool surface and a fixed user
 *    message, then the real message proceeds on turn #2 with the promoted
 *    resident catalog already unlocked.
 *  - `src/whoami-standard/` — whoami anchor turn: same zero-tool first
 *    request but seeded with a fixed "你是谁" self-introduction prompt
 *    instead of the generic anchor notice.
 *
 * Preset subdirectories reference `../preset/*.mjs` for shared plugin files
 * (tool-bootstrap, custom-bash, dev-tool-search, instruction-hint,
 * skill-search, and the compaction-epoch helper).
 *
 * @module @deepseek-ai/dsh-preset-anchored-standard
 */

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const DIRNAME = typeof __dirname !== 'undefined'
  ? __dirname
  : dirname(fileURLToPath(import.meta.url))

const SOURCE_DIR = resolve(DIRNAME, '..', 'src')

export const PRESET_ROOT = SOURCE_DIR

export const PRESETS = Object.freeze({
  'anchored-standard': resolve(SOURCE_DIR, 'preset'),
  'zero-anchored-standard': resolve(SOURCE_DIR, 'zero-anchored-standard'),
  'whoami-standard': resolve(SOURCE_DIR, 'whoami-standard'),
})

export type PresetId = keyof typeof PRESETS
