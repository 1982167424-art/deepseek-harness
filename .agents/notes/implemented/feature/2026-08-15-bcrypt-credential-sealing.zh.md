# Agent Note: bcrypt sealing for API keys

Status: implemented

[English](2026-08-15-bcrypt-credential-sealing.md) | 中文

## Problem

通过 harness 添加的 key 以明文形式经 [credentials seam](../../packages/credentials/credentials/README.md) 解析到达 provider，而静态的 `.credentials.yaml` 文档原样保存它们。该文档是 `0600`，挡住的是其他 OS 用户——挡不住备份、配置界面，以及[安全边界](../../packages/credentials/credentials-local/README.md#security-boundary)已经点名的同 UID 进程。共享一个 dotfile 或渲染设置界面因此等于共享一个可用的秘密；而轮换或误输入的环境 key 只会在请求已经发出之后，以一句难以理解的上游 `401` 浮现。

## Decision

**封存为明文通道加栓，而不是取而代之。** `dsh-credentials-bcrypt` 注册 `ctx.bcryptCredentials`，其 `seal(ref, value)` 对 key 做 bcrypt 哈希并只把摘要存入派生的 pin 引用（`DEEPSEEK_API_KEY` → `DEEPSEEK_API_KEY_BCRYPT`）；明文仍按操作经由 seam 既有的层到达。每次校验都重新解析明文并与摘要比对，于是文档变得可共享、可渲染而不含可用秘密，现行 key 与封存值之间的漂移是一次响亮的本地失配，而不是远程认证失败。

**操作按引用显式进行。** `unseal` 移除 pin（pin 不存在时空操作），`status` 返回 `{ pinned, verified? }` 且不含任何秘密，`assertVerified` 在明文缺失或失配时立即报错——预期调用点是封存 key 首次上游使用之前。`verifyApiKey` 在比对边界直接拒绝非 bcrypt 摘要（modular-crypt `$2[aby]$` 前缀）的存量值：被手工写坏的 pin 永远无法通过校验，理应得到具名错误而非沉默失配。

**更新时校验是观察者而非闸门。** `verifyOnUpdate`（默认开启）时，pin 任一侧的已提交变更经 `credentials/updated` 重跑比对；失配记录为错误、绝不重抛——写入既已提交，损坏的观察者不能让它看起来失败。监听器是服务 effect，随服务消亡——已存 pin 不受销毁影响。

**配置经过校验、只做一次默认、且全局共享。** `cost`（默认 `10`）、`pinSuffix`（默认 `_BCRYPT`，仅 `[_A-Za-z0-9]`，保证 pin 永不与明文引用冲突）与 `verifyOnUpdate` 经由同一个 `resolveSpec` 解析，Schemastery schema 与编程构造共用。哈希由 `bcryptjs`（纯 JavaScript）承担；原生 `bcrypt` addon 的 node-gyp 构建是这个 seam 不需要承担的部署风险。

## Alternatives considered

**对存量 key 加密而不是哈希。** 否决：解密需要一个本身静态存在于某处的密钥，把问题原样下移一层；bcrypt 的单向摘要加上按操作的明文解析，在不存在任何可恢复秘密的前提下给出校验能力。

**把摘要存进本包自有的 sidecar 文件。** 否决：凭据文档已是 seam 的持久存储，具备原子写与热重载；第二个文件使失败模式翻倍，并从 `describe()` 驱动的界面上消失。

**在 seam 内部对每次 resolve 做校验。** 否决：那会把每个凭据消费方耦合到 bcrypt 开销延迟，并让基础 seam 依赖本包；封存按 key 自愿加入，校验属于显式检查与更新时观察。

**更新时校验失配则让写入失败。** 否决：事件触发时变更已提交；从监听器重抛会把一次成功的轮换误报为失败。

## Consequences

封存后 key 的文档只携带 60 字符摘要而非秘密，轮换在任一侧变化的瞬间即被发现——代价是每次显式检查多一次 bcrypt 比对（cost 10 下约几十毫秒），以及明文仍须存在于某处才能校验。要把 key 与运行中的 agent 隔离的部署仍需延后的 OS 钥匙串 provider；封存抬高的是静态文档的门槛，不是进程边界。pin 引用模式落地为派生凭据引用的第二个消费者，未来的钥匙串 provider 可复用它做自己的锚定。覆盖位于包内套件：摘要形态、seal/unseal/status/assertVerified 行为、后缀边界、更新时复查（含销毁与关闭开关两种情形），以及 invariant 伴随件的生命周期守卫。
