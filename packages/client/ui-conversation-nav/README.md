# @deepseek-ai/dsh-client-ui-conversation-nav

Left-side draggable conversation navigation panel. Click to jump to any message / turn / step.

## Features

- Timeline view of conversation turns with step summaries
- Click a turn or step to scroll the conversation viewport to that location
- Floating, resizable (width) and draggable (reposition) panel
- Minimize panel to icon button
- Panel position / size / open state remembered PER CONVERSATION (session-scoped durable storage)
- Keyboard shortcut: Ctrl/Cmd + Shift + F to toggle panel
- Navigation items: `{seq, kind, turnLabel, previewText, anchorId}`
- Bilingual UI strings (English / Simplified Chinese)
