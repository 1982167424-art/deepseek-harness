# Agent Note: 多提供商壁纸生成与 AI 提示词润色

Status: implemented

[English](2026-08-16-wallpaper-multiprovider-generation-and-polish.md) | 中文

## Problem

壁纸工作室此前只能导入用户已有的图片，媒体生成包在每个能力上只对接一家图片提供商和一家视频提供商。用户的密钥属于其他厂商时会得到硬失败而不是结果；只有模糊想法（"来个日落之类的"）的用户必须凭空写出生产级提示词。导入校验接受浏览器能抓取的任意 URL，WebP 和 GIF 因此混入一个客户端按静态 JPEG/PNG 渲染的库；工作室界面使用不透明面板，观感是通用设置页而非产品其他地方采用的玻璃材质。

## Decision

**图片生成在全部 CherryStudio 内置提供商间展开；视频保持三个条目（两家唯一厂商）。** `MediaProvider` 覆盖 CherryStudio 自带的全部 62 个 id（23 家直接厂商、9 家云平台、5 家本地/自托管、5 家推理平台、23 家聚合网关），外加为 cordis.yml 向后兼容保留的三组历史别名：`volcengine` ↔ `doubao`、`siliconflow` ↔ CherryStudio 的 `silicon`、`newapi` ↔ CherryStudio 的 `new-api`。`IMAGE_PROVIDERS` 按默认策略优先级排列这 68 个条目：火山引擎/豆包 Seedream 5.0 居首，OpenAI gpt-image-2 其次，MiniMax 与有图片端点的国内厂商再次，之后是有已知默认的海外 OEM 与聚合商，末位是始终需要用户显式配置的市场平台与本地/自托管条目，它们在未设置时会在 `auto` 下自行跳过。`VIDEO_PROVIDERS` 保持封闭为 `['volcengine', 'doubao', 'minimax']`（默认 Seedance 2.5 与 MiniMax-H3），因为它们是本仓库内请求/响应契约经过验证的仅有视频 API；为视频固定任何其他提供商会以 `INVALID_REQUEST` 失败并点名能力。只有四家提供商拿到专用适配器文件——火山引擎/豆包（`arkBaseURL`、ARK 任务轮询）、MiniMax（`groupIdEnv`）、DashScope（异步万相任务 id）——其余所有 id 都走一个共享的 OpenAI 兼容适配器；68 个提供商槽位的 z schema 通过迭代 `IMAGE_PROVIDERS` 构建，将来新增 id 只需在 types.ts 改一处，而不是三处并行改 index.ts。

**选择策略是 `auto` 顺序回退，或固定的响亮失败。** `provider: 'auto'` 时服务通过凭据 seam 解析池内全部成员，按声明顺序尝试已配置者，逐家收集错误，全部失败后才抛出携带拼接错误列表的 `TRANSPORT`。固定选择的提供商缺少密钥时立即以 `MISSING_CREDENTIAL` 失败并点名应设置的环境变量——`PROVIDER_KEY_ENV` 现在穷尽覆盖全部 68 个 id，全部采用 `UPPERCASED_PROVIDERNAME_API_KEY`（与 CherryStudio 的凭据-seam 约定一致：`DEEPSEEK_API_KEY`、`MOONSHOT_API_KEY`、`302AI_API_KEY`、`AZURE_OPENAI_API_KEY` 等）。`PROVIDER_DEFAULT_BASE_URL` 为每个有公开端点的提供商附上文档地址；纯 LLM 厂商、私有云变体与透传提供商故意留 `undefined` 让用户自行设置；`resolveProviderEntry` 在 `baseURL` 或 `imageModel` 任一项为空时返回 `undefined`，这正是把未配置提供商剔除出 `auto` 轮次、而不是发出半缺省请求的机制。`PROVIDER_DEFAULT_IMAGE_MODEL` 只在上游网关确实暴露 `/v1/images` 的地方挑一个广泛使用的默认值——混元图生图、Vertex Imagen 3、Bedrock SDXL、Together/Fireworks FLUX、OpenRouter flux-schnell、硅基 Kolors、302AI/AIHubMix/DmxAPI/TokenFlux gpt-image-1、ModelScope Wan2.1、Hugging Face FLUX.Schnell——而 DeepSeek、Moonshot、Anthropic、Cerebras、Groq、Perplexity、Copilot、Poe、冷门厂商与全部纯本地运行器都不带默认模型，因此在用户显式配置之前对 `auto` 不可见。

**润色是独立的、计费的、先确认的步骤。** `media_polish_prompt`（及工作室的 `/api/wallpaper/polish`）把用户的粗略想法发给配置的聊天模型——默认 DeepSeek v4 flash——配合两个按目标定制的系统提示词之一（图片：主体、构图、光线、色调、镜头、风格；视频：动作、镜头运动、节奏），返回改写后的提示词供用户在生成之前接受或丢弃。润色请求本身是计费模型调用：不满意丢弃文本但绝不退还花费，工具描述与工作室文案都写明了这一点，让模型和用户在选择润色之前都听到这条规则。

**生成媒体落入壁纸库；导入仅限 JPEG/PNG。** `/api/wallpaper/generate` 调用 `ctx.mediaGen`，把返回字节作为媒体 blob 存入扩展后的 `WallpaperStore`，返回标记 `source: 'generated'` 并带 `media` 与 `provider` 的 `WallpaperItem`，网格缩略图因此对视频渲染 `<video>`，条目也记录产出厂商。URL 导入只接受 `.jpg`/`.jpeg`/`.png` 扩展名（`URL_IMAGE_EXT`），文件选择器设置 `accept=".jpg,.jpeg,.png"`，两条路径对其余格式以具名错误拒绝，而不是信任 content-type 嗅探。工作室表面——拖放区、生成面板、控件、缩略图、润色结果——采用液态玻璃处理：半透明 `color-mix` 背景、`backdrop-filter: blur(24px) saturate(180%)`、发丝级边框与成对的内侧高光。

## Alternatives considered

**每个能力硬编码一家提供商（原有状态）。** 拒绝，因为它把缺失密钥变成死功能；顺序回退降级到用户实际付费的厂商，池顺序仍把产品偏好的火山引擎默认项排在最前。

**机械复制 CherryStudio id 不带别名。** 拒绝，因为它会悄悄打破任何人 cordis.yml 里已有的 `volcengine:` 或 `siliconflow:` 键；保留三组 id 对只花一张查表表，让两种写法路由到完全相同的行为。

**在生成调用内部润色。** 拒绝，因为它把一次计费模型请求藏进另一次计费请求，并剥夺用户在图片或视频花费之前拒绝糟糕改写的机会；独立步骤多付一次往返，换回不可退款规则所要求的确认。

**导入的客户端文件类型嗅探。** 拒绝，因为库格式契约由服务端持有；API 边界的扩展名检查加上选择器的 `accept` 属性在入口处响亮失败，而不是上传之后。

**靠猜测其他厂商的请求格式扩大视频池。** 拒绝，因为未验证的线上契约会在运行时以真金白银失败；两家经过验证的提供商加封闭池、其余具名报错，才是诚实的表面，直到每个新增者都经过测试。

**手工在 z schema 里逐字写出 68 个提供商字段。** 拒绝，因为 types.ts → Config 接口 → Config schema 字段的三方漂移正是提供商最初不同步的根源；通过迭代 `IMAGE_PROVIDERS` 构建形状只有一处改动点、一种出错模式。

## Consequences

一个部署只需要池内各一把图片与视频密钥即可生成两种媒体，代价是维护四个适配器文件，各厂商的特例（ARK 轮询、DashScope 任务 id、MiniMax group id）都藏在一个 `ResolvedProvider` 可辨识联合之后。新增提供商现在的成本是 types.ts 里改两行（联合 + 池顺序）、三个 68 条目 `Record<MediaProvider, _>` 表里各加一行、再检查一下 `resolveProviderEntry` 的默认分支能否产出合理的 OpenAI 兼容默认值；有专用适配器的提供商（火山引擎/豆包、MiniMax、DashScope）才需要动到那个 switch。把视频池从 `['volcengine','doubao','minimax']` 向外扩大，意味着要在新适配器的测试里明确记录上游线上契约——封闭池正是让"固定无效提供商"错误可检验的前提。润色花费除常规 llm 计费路径外不被本仓库追踪；不退款是声明的产品规则，而非此处机制。覆盖为无密钥测试：包契约测试固定了提供商排序失败（缺失环境变量名、图片-only 提供商被固定用于视频）与润色流程（正常路径、空想法、禁用配置、`EMPTY_RESPONSE`），全部对着脚本化的 llm 流。两个包都尚未接入任何可运行示例，因此工作室流程没有装配级 transcript snapshot——第一个挂载 `ui-wallpaper` 的示例欠下这一份；各厂商线上契约的真实 API 验证留待有密钥时的 e2e。
