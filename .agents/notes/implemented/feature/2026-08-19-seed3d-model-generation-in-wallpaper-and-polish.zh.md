# Agent Note：字节 Seed 3D 2.0 / Hyper 3D 生成与 3D 提示词润色

状态：implemented

[English](2026-08-19-seed3d-model-generation-in-wallpaper-and-polish.md) | 中文

## 问题

壁纸多提供商能力已经支持图片与视频，但产品对外宣传的第三类媒体是字节通过火山引擎 ARK 提供的 Seed 3D 2.0（以及 Hyper 3D Gen2）文生/图生 3D。此前用户纯文字描述 3D 资产时，要么走了图片链路，要么根本没有入口；同时提示词润色步骤只会按 2D 图像与视频镜头的方向改写，导致一个粗略的 3D 想法（例如"低面数森林狐狸"）也被润写成静态画面文案，而不是强调几何形状、材质贴图、细分级别的 3D 提示词。引入 3D 能力时还不能重现之前 provider 漂移的问题：模型池、配置 schema、润色目标、壁纸 blob 形态、前端 kind 联合类型，必须一次性全部认识 `model`。

## 决定

**`MODEL_PROVIDERS = ['volcengine', 'doubao']` 复用 ARK 适配器；能力维度统一为 `'model'`。** `MediaProvider` 已经为 `volcengine` ↔ `doubao` 建立别名，并且两者在异步图生/文生视频任务上共享同一套 ARK 报文格式，因此 3D 生成只新增一条适配器分支（`generateModelVolcengine` → `usesArkModelGen(model)` → `generateModelArk`），而不新建独立 provider 文件。ARK 模型生成走三段式异步协议，并有自己的长超时：先 `POST ark-cn-beijing.volces.com/api/v3/ark-3d/text2task` 拿到任务 ID，再轮询 `GET …/tasks/{id}` 直至 `Succeeded`（15 分钟上限放在 `ARK_MODEL_POLL_TIMEOUT_MS`，和 5 分钟图片/视频超时分开，因为 3D 拓扑重建和 USDZ 打包以分钟计），最后通过 `GET …/tasks/{id}/download` 拉取二进制产物。接受的 3D 载荷类型为 `model/gltf-binary` 与 `application/zip`，写入 `GeneratedModel.mediaType`，以便 blob 存储和临时路由返回正确的响应头。

**`GenerateModelArgs` 用一份请求同时承载文生 3D 与图生 3D，并允许细分与文件格式锁定。** `subdivision: 'low' | 'medium' | 'high'` 对应 Seed 3D 2.0 支持的三档面数（约 10 万 / 50 万 / 100 万面）；`fileFormat: 'glb' | 'obj' | 'usd' | 'usdz'` 选择输出格式；`imageUrl` 是可选的参考图输入，提供后 Seed 3D 切换到图生 3D 模式（当 `prompt` 为空但 `imageUrl` 存在时仍允许生成，`MediaGenService.generateModel` 内部会校验这一"或条件"并抛 `INVALID_REQUEST`，把约束显式写进错误信息）。`provider` 与 `model` 两个字段允许调用方锁定提供商或具体模型 ID（如 `doubao-seed3d-2-0-260328` 与 `hyper3d-gen2-260112`）；默认值仍通过图片/视频复用的 `resolveProviderEntry` 选择器落在 Volcengine 配置上，`orderedProviders(settings, 'model', requested)` 继续复用 `auto` 凭据排序策略，因此只要 Doubao 配置了密钥就会优先于仅配 Volcengine 的条目，不需要用户手动指定。

**提示词润色新增 `PolishTarget = … | 'model'`，并提供 3D 专用系统提示词。** `POLISH_SYSTEM_PROMPTS` 增加 `model` 一项：要求对话模型把用户的粗略想法改写成 40–120 字的中文文生 3D 提示词，覆盖主体形态、几何特征、表面材质与纹理细节、用途场景、对称性与比例——恰好是 Seed 3D 与 Hyper 3D 挑选初始网格与材质 LOD 时最看重的维度。润色本身仍然是单独计费的步骤，沿用"不满意不退款"的产品规则；壁纸 API 只需在 `/api/wallpaper/polish` 上额外接受 `target: 'model'`（与既有的 `'image' | 'video'` 并列），底层继续走同一条 `mediaGen.polishPrompt(request)` 路径。

**壁纸 `/api/wallpaper/generate` 直接把已有的 kind 判别联合扩展为 `kind: 'model'`。** 没有拆出新的 `/api/wallpaper/generate-model` 端点（否则要复制一份 blob 访问、临时 URL 分发、列表语义和 `storeGeneratedMedia` 辅助函数）。`WallpaperGenerateKind` 扩成 `'image' | 'video' | 'model'`，`parseGenerateRequest` 接收 3D 专属字段：`imageUrl`、`subdivision`、`fileFormat`、`model`。provider 池按 kind 区分，所以 `auto` 只尝试具备 3D 能力的供应商，不会因为配置了一堆图片提供商就发生误匹配。生成的 3D 资产以 `media: 'model'` 存入壁纸条目，名称前缀改为 `3D · …`，并在条目上记录 `modelFileFormat` / `modelSubdivision` 供展示网格和下载卡片使用；沿用 `source: 'generated'` / `moderationStatus: 'passed'` 的既有策略，因为 3D 与图片/视频一样都是 ARK 上游完成内容安全审核后再返回产物。

## 被否决的替代方案

**单独新建 `/api/wallpaper/generate-model`。** 否决原因：会重复 blob-store、临时 URL、列表逻辑、`storeGeneratedMedia` 等一整套代码。复用 kind 联合，仅在已有的判别分发里加一条分支，就能让图书馆面把 3D 资产当作一等壁纸条目（自带预览/下载交互）。

**把 `PolishTarget.model` 默认复用图像提示词。** 否决原因：图像风格提示词（柔光、电影感）会把 Seed 3D 误导到"靠贴图和假光照凑画面"的方向，而一份 raytrace-ready glTF 恰恰不需要这些噪声。3D 系统提示词专门强调几何 + 材质属性，二者不可互换。

**3D 继续复用 5 分钟 `ARK_POLL_TIMEOUT_MS`。** 否决原因：3D 烘焙的计算量比图像扩散高两个数量级；15 分钟上限是覆盖 100 万面 USDZ 导出最坏情况的最短超时，同时又不会让真正失败的请求等到天荒地老。

## 影响

未来在 Volcengine/Doubao 之外新增 3D 提供商，只需要在 `generateModelVolcengine`（或独立适配器文件）里补一条 `usesXxxModelGen(model)` 分支，并把 provider id 追加到 `MODEL_PROVIDERS` 与三组 `Record<MediaProvider, _>` 环境/默认值表即可；`generate-model` 工具 schema 也是基于这些常量构建，避免多处漂移。3D 链路的覆盖率目前依靠无密钥的包内单元测试锁定 provider 排序不变量与润色分支；真实 ARK 密钥 3D 调用仍然走 `test:e2e` 门，因为 CI 环境默认不携带凭据。壁纸库对 `media: 'model'` 的扩展是纯加法：旧壁纸条目读取不受影响；只有客户端展示层在识别到 `WallpaperItem.modelFileFormat` 后才会渲染 3D 预览，否则默认展示下载卡片。
