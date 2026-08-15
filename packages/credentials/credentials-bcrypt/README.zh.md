# dsh-credentials-bcrypt

[English](README.md) | 中文

为加入 harness 的 API key 提供 bcrypt 封存：凭据文档只存摘要，每次校验都通过 [credentials](../credentials/README.md) seam 重新解析现行明文。

bcrypt 是单向哈希，因此封存并不取代明文通道——而是为它加栓。`seal` 将 key 哈希后把摘要存入派生引用（`DEEPSEEK_API_KEY` → `DEEPSEEK_API_KEY_BCRYPT`）；明文仍按操作经由 seam 自身的层（继承环境、`.credentials.yaml`、`.env`）到达。于是静态文档可以被共享、备份或展示在配置界面而不暴露可用秘密，轮换或误输入的环境 key 会以明确的失配暴露出来，而不是上游一句难以理解的 `401`。

## Surface

| 成员 | 含义 |
|---|---|
| `seal(ref, value)` | 哈希 `value` 并把摘要存入 pin 引用。 |
| `unseal(ref)` | 移除 pin；对不存在的 pin 是空操作。 |
| `status(ref)` | `{ pinned, verified? }` — 可安全用于配置界面，绝不携带摘要或明文。 |
| `assertVerified(ref)` | 已封存引用的明文缺失或失配时立即报错。 |
| `pinnedDigest(ref)` | 已存摘要；未封存时为 `undefined`。 |
| `hashApiKey` / `verifyApiKey` | 摘要原语；`verifyApiKey` 对非 bcrypt 摘要直接拒绝而不是去比较。 |

## Config

| 字段 | 默认值 | 含义 |
|---|---|---|
| `cost` | `10` | bcrypt 开销因子；越高每次封存与校验越慢。 |
| `pinSuffix` | `_BCRYPT` | 派生 pin 引用的后缀；仅 `[_A-Za-z0-9]`，保证 pin 永远不会与明文引用冲突。 |
| `verifyOnUpdate` | `true` | pin 任一侧的已提交变更触发重新校验。 |

## Update-time verification

`verifyOnUpdate` 开启时，pin 任一侧的已提交变更都会重跑比对：明文变更复查它自己的 pin，摘要变更复查基础引用。写入既已提交，失配只记录为错误而不重抛——损坏的观察者不能让一次成功的写入看起来失败。监听器与服务同生命周期；销毁即停止复查，已存 pin 不受影响。

## Model Experience

Indirectly, through the consuming LLM adapters: a verified value authorizes their provider requests, and the adapter owns every model-visible surface.

#### KV Cache effect

No direct invalidation; digests and plaintexts never enter a request prefix.

## Known Limitations and Deferred Work

- **明文仍须存在于某处** — bcrypt 负责校验而非替代；要把 key 与运行中的 agent 隔离的部署需要 OS 钥匙串 provider，它仍是 [`dsh-credentials-local`](../credentials-local/README.md) 之外的延后答案。
- **没有一键全封存** — 封存按引用显式进行；想要钉住所有已存 key 的界面自行枚举并逐一封存。
- **开销是全局的而非按 key** — 一个配置值覆盖所有封存；按引用指定开销没有消费方。
- **校验是检查时而非持续** — 两次更新之间，明文漂移由 `assertVerified` 或 `status` 捕获，二者都由调用方发起。
