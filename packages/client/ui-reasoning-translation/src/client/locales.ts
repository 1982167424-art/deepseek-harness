export const zh = {
  translateCot: '翻译思维链',
  translationOnOff: '翻译思维链 (中)',
  selectModel: '选择翻译模型',
  translationTabOriginal: '原文',
  translationTabChinese: '翻译',
  translating: '翻译中…',
  translationModel: '翻译模型',
  translationPrompt: '翻译提示词',
  settingsSection: '思维链翻译设置',
  enabledByDefault: '默认开启翻译',
  translationTyping: '正在翻译…',
} satisfies Record<string, string>

export type ReasoningTranslationKey = keyof typeof zh

export const en = {
  translateCot: 'Translate Chain-of-Thought',
  translationOnOff: 'Translate reasoning (ZH)',
  selectModel: 'Select translation model',
  translationTabOriginal: 'Original',
  translationTabChinese: 'Translation',
  translating: 'Translating…',
  translationModel: 'Translation Model',
  translationPrompt: 'Translation Prompt',
  settingsSection: 'Reasoning Translation Settings',
  enabledByDefault: 'Enable translation by default',
  translationTyping: 'Translating…',
} satisfies Record<ReasoningTranslationKey, string>
