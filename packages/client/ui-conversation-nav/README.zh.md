# @deepseek-ai/dsh-client-ui-conversation-nav

左侧可拖动的对话导航面板。点击跳转到任意消息 / 回合 / 步骤。

## 功能

- 时间线视图：展示所有对话回合及步骤摘要
- 点击回合或步骤滚动对话视图至对应位置
- 浮动面板：支持调整宽度、拖动位置
- 可最小化为图标按钮
- 面板位置 / 尺寸 / 打开状态按会话独立记忆（会话级持久化存储）
- 快捷键：Ctrl/Cmd + Shift + F 切换面板显示
- 导航条目结构：`{seq, kind, turnLabel, previewText, anchorId}`
- 双语界面字符串（英文 / 简体中文）
