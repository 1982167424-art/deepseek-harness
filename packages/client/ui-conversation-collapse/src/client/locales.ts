/** `conversation-collapse` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  collapseReasoning: '自动折叠推理内容',
  collapseToolCalls: '自动折叠工具调用',
  expandWorkflowLabel: '展开流程',
  collapseWorkflowLabel: '收起流程',
  expandAllTurns: '展开全部流程',
  collapseAllTurns: '收起全部流程',
} satisfies Record<string, string>

/** The conversation-collapse namespace key union. */
export type ConversationCollapseKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  collapseReasoning: 'Auto-collapse reasoning content',
  collapseToolCalls: 'Auto-collapse tool calls',
  expandWorkflowLabel: 'Expand workflow',
  collapseWorkflowLabel: 'Collapse workflow',
  expandAllTurns: 'Expand all workflow',
  collapseAllTurns: 'Collapse all workflow',
} satisfies Record<ConversationCollapseKey, string>
