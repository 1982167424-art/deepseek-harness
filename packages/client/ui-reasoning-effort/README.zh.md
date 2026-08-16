# @deepseek-ai/dsh-client-ui-reasoning-effort

中文 | [English](README.md)

思考强度（推理深度）浏览器 UI 插件：在输入栏工具条上增加一个小型芯片选择器，让用户在「关 / 高 / 最大」之间切换当前会话的推理强度。写入通过与模型选择插件相同的 `sessions.selectModel` RPC（provider + model + reasoningEffort 三元组）完成，两个插件共享同一个 Host 事实源，不直接相互依赖即可保持同步。

占用 `conversation.input.right` 列表席位：位于发送按钮左侧，紧跟在模型选择芯片之后。三个选项与 DeepSeek 适配器的 `REASONING_EFFORTS` 三元组完全一致（`off` / `high` / `max`）；OpenRouter 兼容提供商经由 `llm-openrouter` 序列化路径时，除上述三项外还透明支持 `low` 与 `medium`。当会话当前 provider 的模型目录中不声明推理能力时，选择器保持可点击但仍显示当前有效强度，写入会在 Host 端返回明确的「不支持该 effort」错误。

芯片按钮显示当前生效的强度标签，开启思考时会以强调色展示思考图标；下拉菜单列出三档选项及各自的中文说明文案，并应用乐观 UI：按钮立即反映新值，RPC 失败则回滚按钮并在菜单底部显示内联错误状态。

## 全链路接线

从用户点击到模型请求：

1. 在菜单中点击某一选项后，组件调用 `sessions.selectModel`，参数为当前 sessionId、该会话当前的 provider 与 model，以及新的 `reasoningEffort` 字符串。
2. Host 端的 sessions 网关校验 effort 是否在该 provider 的模型目录中（若不匹配，返回 `model-unavailable`，附带「provider X does not support reasoning effort Y」的消息），通过后将 effort 写入会话的 selection。
3. 下一轮 `agent/request` waterfall 通过 `selectionFor()` 读取会话的 selection，把 branded 的 effort id 填入 `GenerateOptions.reasoningEffort`。
4. `@deepseek-ai/dsh-llm-deepseek` 的 `serialize.resolveThinking` 映射：
   - `off` → `{ thinking: 'disabled' }`（不产生推理 token）
   - `high` → `{ thinking: 'enabled', reasoning_effort: 'high' }`
   - `max` → `{ thinking: 'enabled', reasoning_effort: 'max' }`
5. `@deepseek-ai/dsh-llm-openrouter` 的解析器额外允许 `low` / `medium`，并以相同字符串透传到 JSON 请求中。

`@deepseek-ai/dsh-agent-default-model` 中新增的 `SessionModelSettings` 辅助函数（`effectiveEffortId`、`settingsFromEffortId` 等）为需要同时呈现「开关 + 强度」两段 UI 的组件提供了 `{ thinkingEnabled, thinkingEffortId }` 的双字段视图。

## 本地化

命名空间 `reasoning`。所有文案集中在 `locales.ts`（zh + en）。新增语言只需通过同样的 slot-contract 合并模式扩展 `LocaleNamespaceMap.reasoning` 联合即可。

## 已知限制与后续工作

- **目前只写死三档**：菜单不根据 provider 元数据中的 `efforts` 列表进行过滤，不支持的 effort 通过 Host 端校验来拒绝，而不是在客户端预先隐藏。
- **消息流内部无逐轮思考徽章**：消息级的推理指示（含 Chain-of-Thought 展开器）属于聊天渲染包，不属于该工具条席位插件。
- **仅 Host 事实同步**：同一会话的多个客户端通过订阅 Host 事实流保持一致，此插件不引入任何客户端私有状态。
