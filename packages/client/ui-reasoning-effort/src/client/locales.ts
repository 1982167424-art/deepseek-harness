/**
 * `reasoning` namespace dictionaries.
 *
 * Keys fall into two groups:
 * - Static labels on the toggle/dropdown trigger (reasoningEffort, each effort*).
 * - Status indicators shown while a turn is in flight (reasoningIndicator*).
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  reasoningEffort: '思考强度',
  effortOff: '关 ⚡（快速，不思考）',
  effortHigh: '高 💡（平衡思考深度与速度）',
  effortMax: '最大 🧠（最慢，最强推理链）',
  reasoningIndicatorOff: '思考已关闭',
  reasoningIndicatorActive: '使用 {level} 强度思考中…',
  triggerAria: '思考强度选择器，当前 {state}',
  toggleLabel: '深度思考',
  toggleAriaOn: '深度思考已开启',
  toggleAriaOff: '深度思考已关闭',
  dropdownOff: '关 ⚡',
  dropdownHigh: '高 💡',
  dropdownMax: '最大 🧠',
  stateOff: '关闭',
  stateHigh: '高',
  stateMax: '最大',
  stateDefault: '跟随模型默认',
  statusSubmitting: '正在应用选择…',
  statusFailed: '应用失败：{message}',
} satisfies Record<string, string>

/** The reasoning namespace key union. */
export type ReasoningKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  reasoningEffort: 'Thinking Intensity',
  effortOff: 'Off ⚡ (fast, no reasoning)',
  effortHigh: 'High 💡 (balance depth & speed)',
  effortMax: 'Max 🧠 (slowest, strongest chain-of-thought)',
  reasoningIndicatorOff: 'Reasoning disabled',
  reasoningIndicatorActive: 'Thinking at {level} intensity…',
  triggerAria: 'Reasoning effort selector, current {state}',
  toggleLabel: 'Deep Thinking',
  toggleAriaOn: 'Deep thinking enabled',
  toggleAriaOff: 'Deep thinking disabled',
  dropdownOff: 'Off ⚡',
  dropdownHigh: 'High 💡',
  dropdownMax: 'Max 🧠',
  stateOff: 'Off',
  stateHigh: 'High',
  stateMax: 'Max',
  stateDefault: 'Model default',
  statusSubmitting: 'Applying selection…',
  statusFailed: 'Apply failed: {message}',
} satisfies Record<ReasoningKey, string>
