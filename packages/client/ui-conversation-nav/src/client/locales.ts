/** `conversation-nav` namespace dictionaries. */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  navPanelTitle: '对话导航',
  turnLabel: '回合 {n}',
  stepTool: '工具调用',
  stepReasoning: '推理',
  stepMessage: '消息',
  jumpToMsg: '跳转至消息',
  togglePanel: '切换导航面板',
  panelWidth: '面板宽度',
  expandAllTurns: '展开全部回合',
  collapseAllTurns: '收起全部回合',
  minimizePanel: '最小化面板',
  closePanel: '关闭面板',
  scrollToTop: '滚动到顶部',
} satisfies Record<string, string>

/** The conversation-nav namespace key union. */
export type ConversationNavKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  navPanelTitle: 'Conversation Navigation',
  turnLabel: 'Turn {n}',
  stepTool: 'Tool call',
  stepReasoning: 'Reasoning',
  stepMessage: 'Message',
  jumpToMsg: 'Jump to message',
  togglePanel: 'Toggle navigation panel',
  panelWidth: 'Panel width',
  expandAllTurns: 'Expand all turns',
  collapseAllTurns: 'Collapse all turns',
  minimizePanel: 'Minimize panel',
  closePanel: 'Close panel',
  scrollToTop: 'Scroll to top',
} satisfies Record<ConversationNavKey, string>
