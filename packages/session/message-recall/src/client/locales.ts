/**
 * `recall` namespace dictionaries.
 */

export const zh = {
  'recallMessage': '撤回',
  'autoRestoreFiles': '自动还原已修改文件',
  'confirmRecallTitle': '确认撤回消息',
  'confirmRecallBody': '撤回后将删除此消息及后续对话，AI 修改过的文件将自动还原。此操作无法撤销。',
  'recallSuccess': '撤回成功',
  'recallFailed': '撤回失败',
  'filesRestoredLabel': '已还原文件',
  'error.outOfWindow': '超出可撤回时间窗口',
  'error.sessionNotFound': '会话不存在',
  'error.generic': '撤回操作失败',
} satisfies Record<string, string>

export type MessageRecallKey = keyof typeof zh

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    recall: MessageRecallKey
  }
}

export const en = {
  'recallMessage': 'Recall',
  'autoRestoreFiles': 'Auto-restore modified files',
  'confirmRecallTitle': 'Confirm message recall',
  'confirmRecallBody': 'Recalling will remove this message and all subsequent turns. Files edited by the AI will be automatically restored. This cannot be undone.',
  'recallSuccess': 'Recall successful',
  'recallFailed': 'Recall failed',
  'filesRestoredLabel': 'Files restored',
  'error.outOfWindow': 'Outside recall window',
  'error.sessionNotFound': 'Session not found',
  'error.generic': 'Recall operation failed',
} satisfies Record<MessageRecallKey, string>
