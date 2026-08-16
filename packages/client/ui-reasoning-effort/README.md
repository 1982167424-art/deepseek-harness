# @deepseek-ai/dsh-client-ui-reasoning-effort

English | [中文](README.zh.md)

Reasoning effort (thinking intensity) browser-surface plugin: adds a small chip selector to the composer tool row that lets the user switch the session's reasoning effort among off / high / max. Selection is written through the same `sessions.selectModel` RPC that the model-select plugin uses (provider + model + reasoning effort), so the two plugins share a single host fact and stay synchronized without any direct cross-package dependency.

Occupies the `conversation.input.right` list seat — immediately left of the send button, after the model-select chip. The three options map exactly to the DeepSeek adapter's `REASONING_EFFORTS` triplet (`off` / `high` / `max`); OpenRouter-compat providers that route through `llm-openrouter` transparently accept the same string ids plus `low` and `medium` via their own serialization path. When the session's provider declares no reasoning support the selector is inert but still reflects the effective effort.

The chip shows the currently-active effort label (including a thinking icon tint when reasoning is enabled), the popover lists the three options with hint copy, and optimistic UI is applied: the trigger reflects the new value immediately, while any RPC failure rolls the trigger back and surfaces an inline status line.

## Wiring

From user click to model request:

1. Clicking an option in the popover calls `sessions.selectModel` with the session id, the session's current provider + model, and the new `reasoningEffort` string.
2. The host's sessions gateway validates the effort against the provider's model catalog (`provider does not support reasoning effort X` when rejected) and — on success — stores the effort on the session's selection.
3. The next `agent/request` waterfall reads the session's selection through `selectionFor()`; `GenerateOptions.reasoningEffort` receives the branded id.
4. `@deepseek-ai/dsh-llm-deepseek` `serialize.resolveThinking` maps:
   - `off` → `{ thinking: 'disabled' }` (no reasoning tokens)
   - `high` → `{ thinking: 'enabled', reasoning_effort: 'high' }`
   - `max` → `{ thinking: 'enabled', reasoning_effort: 'max' }`
5. `@deepseek-ai/dsh-llm-openrouter`'s resolver additionally allows `low` and `medium` and passes the same string through its JSON wire format.

`SessionModelSettings` helpers in `@deepseek-ai/dsh-agent-default-model` (`effectiveEffortId`, `settingsFromEffortId`, etc.) provide the two-field view (`thinkingEnabled` boolean + `thinkingEffortId` string) for any surface that wants to present reasoning as a paired on/off toggle + strength dropdown.

## Locale

Namespace `reasoning`. All strings in `locales.ts`, both zh and en. New locales can be added by extending the `LocaleNamespaceMap.reasoning` union through the same slot-contract merge pattern.

## Known Limitations and Deferred Work

- **Fixed triplet only** — the popover currently shows off/high/max regardless of provider-declared `efforts` metadata; it relies on host validation for unsupported ids rather than filtering the list client-side against the provider's model reasoning catalog.
- **No per-model reasoning icon inside the message list** — a turn-level reasoning badge (including a live chain-of-thought expander) belongs to the chat-render package, not the tool-row seat.
- **Host sync only** — two clients on the same session both stay in sync because they read the host's fact; this add-on introduces no client-only state.
