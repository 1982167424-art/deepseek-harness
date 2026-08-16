# Agent Note: 多提供商壁纸生成与 AI 提示词润色

Status: implemented

[English](2026-08-16-wallpaper-multiprovider-generation-and-polish.md) | 中文

## Problem

壁纸工作室此前只能导入用户已有的图片，媒体生成包在每个能力上只对接一家图片提供商和一家视频提供商。用户的密钥属于其他厂商时会得到硬失败而不是结果；只有模糊想法（"来个日落之类的"）的用户必须凭空写出生产级提示词。导入校验接受浏览器能抓取的任意 URL，WebP 和 GIF 因此混入一个客户端按静态 JPEG/PNG 渲染的库；工作室界面使用不透明面板，观感是通用设置页而非产品其他地方采用的玻璃材质。

## Decision

**图片生成在九家提供商间展开，视频保持两家。** `IMAGE_PROVIDERS` 依次排列火山引擎（Seedream 5.0）、OpenAI（gpt-image-2）、MiniMax、智谱 CogView、阿里万相（DashScope）、SiliconFlow、AihubMix、Tokenflux、NewAPI——即 CherryStudio 在 OpenAI 兼容图片端点上暴露的提供商集合。`VIDEO_PROVIDERS` 保持 `['volcengine', 'minimax']`（默认 Seedance 2.5 与 MiniMax-H3），因为它们是本仓库内请求/响应契约经过验证的仅有视频 API；为视频固定一个不在池内的提供商会以 `INVALID_REQUEST` 失败并点名能力。九家图片提供商中的六家共用一个 OpenAI 兼容适配器（`openai-compatible.ts`）；DashScope 有自己的异步任务轮询适配器；火山引擎与 MiniMax 保留专用适配器，因为其 ARK 任务模型与 group-id 路由并不 OpenAI 兼容。

**选择策略是 `auto` 顺序回退，或固定的响亮失败。** `provider: 'auto'` 时服务通过凭据 seam 解析池内全部成员，按声明顺序尝试已配置者，逐家收集错误，全部失败后才抛出携带拼接错误列表的 `TRANSPORT`。固定选择的提供商缺少密钥时立即以 `MISSING_CREDENTIAL` 失败并点名应设置的环境变量（`PROVIDER_KEY_ENV`）；候选列表为空时点名该能力接受的全部环境变量。NewAPI 不附带默认 base URL 与图片模型，因此在配置之前对 `auto` 不可见——这是有意为之的"未配置即跳过"，而不是发出半缺省的请求。

**润色是独立的、计费的、先确认的步骤。** `media_polish_prompt`（及工作室的 `/api/wallpaper/polish`）把用户的粗略想法发给配置的聊天模型——默认 DeepSeek v4 flash——配合两个按目标定制的系统提示词之一（图片：主体、构图、光线、色调、镜头、风格；视频：动作、镜头运动、节奏），返回改写后的提示词供用户在生成之前接受或丢弃。润色请求本身是计费模型调用：不满意丢弃文本但绝不退还花费，工具描述与工作室文案都写明了这一点，让模型和用户在选择润色之前都听到这条规则。

**生成媒体落入壁纸库；导入仅限 JPEG/PNG。** `/api/wallpaper/generate` 调用 `ctx.mediaGen`，把返回字节作为媒体 blob 存入扩展后的 `WallpaperStore`，返回标记 `source: 'generated'` 并带 `media` 与 `provider` 的 `WallpaperItem`，网格缩略图因此对视频渲染 `<video>`，条目也记录产出厂商。URL 导入只接受 `.jpg`/`.jpeg`/`.png` 扩展名（`URL_IMAGE_EXT`），文件选择器设置 `accept=".jpg,.jpeg,.png"`，两条路径对其余格式以具名错误拒绝，而不是信任 content-type 嗅探。工作室表面——拖放区、生成面板、控件、缩略图、润色结果——采用液态玻璃处理：半透明 `color-mix` 背景、`backdrop-filter: blur(24px) saturate(180%)`、发丝级边框与成对的内侧高光。

## Alternatives considered

**每个能力硬编码一家提供商（原有状态）。** 拒绝，因为它把缺失密钥变成死功能；顺序回退降级到用户实际付费的厂商，池顺序仍把产品偏好的火山引擎默认项排在最前。

**在生成调用内部润色。** 拒绝，因为它把一次计费模型请求藏进另一次计费请求，并剥夺用户在图片或视频花费之前拒绝糟糕改写的机会；独立步骤多付一次往返，换回不可退款规则所要求的确认。

**导入的客户端文件类型嗅探。** 拒绝，因为库格式契约由服务端持有；API 边界的扩展名检查加上选择器的 `accept` 属性在入口处响亮失败，而不是上传之后。

**靠猜测其他厂商的请求格式扩大视频池。** 拒绝，因为未验证的线上契约会在运行时以真金白银失败；两家经过验证的提供商加封闭池、其余具名报错，才是诚实的表面，直到每个新增者都经过测试。

## Consequences

一个部署只需要池内各一把图片与视频密钥即可生成两种媒体，代价是维护四个适配器文件，各厂商的特例（ARK 轮询、DashScope 任务 id、MiniMax group id）都藏在一个 `ResolvedProvider` 可辨识联合之后。新增视频提供商需要编辑 `VIDEO_PROVIDERS` 及其 `PROVIDER_KEY_ENV` 条目——封闭池正是让"固定无效提供商"错误可检验的前提。润色花费除常规 llm 计费路径外不被本仓库追踪；不退款是声明的产品规则，而非此处机制。覆盖为无密钥测试：包契约测试固定了提供商排序失败（缺失环境变量名、图片-only 提供商被固定用于视频）与润色流程（正常路径、空想法、禁用配置、`EMPTY_RESPONSE`），全部对着脚本化的 llm 流。两个包都尚未接入任何可运行示例，因此工作室流程没有装配级 transcript snapshot——第一个挂载 `ui-wallpaper` 的示例欠下这一份；各厂商线上契约的真实 API 验证留待有密钥时的 e2e。
