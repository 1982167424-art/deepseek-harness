# Agent Note: Multi-provider wallpaper generation with AI prompt polish

Status: implemented

English | [中文](2026-08-16-wallpaper-multiprovider-generation-and-polish.zh.md)

## Problem

The wallpaper studio could only import pictures the user already owned, and the media-generation package spoke to exactly one image provider and one video provider per capability. A user whose key belonged to another vendor got a hard failure instead of a result, and a user with only a vague idea ("something with a sunset") had to write a production-grade prompt unaided. Import validation also accepted any URL the browser could fetch, so WebP and GIF slipped into a library the client renders as static JPEG/PNG, and the studio chrome used opaque panels that read as a generic settings page rather than the glass surface the product ships elsewhere.

## Decision

**Image generation fans out across nine providers; video stays at two.** `IMAGE_PROVIDERS` orders Volcengine (Seedream 5.0), OpenAI (gpt-image-2), MiniMax, Zhipu CogView, Aliyun Wanx via DashScope, SiliconFlow, AihubMix, Tokenflux, and NewAPI — the provider set CherryStudio exposes for OpenAI-compatible image endpoints. `VIDEO_PROVIDERS` stays `['volcengine', 'minimax']` (Seedance 2.5 and MiniMax-H3 defaults) because those are the only video APIs with verified request/response contracts here; a provider pinned for video that is not in the pool fails with `INVALID_REQUEST` naming the capability. Six of the nine image providers share one OpenAI-compatible adapter (`openai-compatible.ts`); DashScope gets its own async task-polling adapter; Volcengine and MiniMax keep dedicated adapters because their ARK task model and group-id routing are not OpenAI-compatible.

**Selection is `auto` ordered fallback or a loud pinned failure.** With `provider: 'auto'` the service resolves every pool member through the credentials seam and tries the credentialed ones in declared order, collecting per-provider errors and throwing `TRANSPORT` with the joined list only after all fail. A pinned provider that lacks a key fails immediately with `MISSING_CREDENTIAL` naming the env var to set (`PROVIDER_KEY_ENV`); an empty candidate list names every env var the capability accepts. NewAPI ships no default base URL or image model, so it stays invisible to `auto` until configured — a deliberate unconfigured-is-skipped case rather than a half-defaulted request.

**Polish is a separate, charged, confirm-first step.** `media_polish_prompt` (and `/api/wallpaper/polish` in the studio) sends the user's rough idea to the configured chat model — DeepSeek v4 flash by default — with one of two target-specific system prompts (image: subject, composition, light, palette, lens, style; video: action, camera movement, pacing) and returns the rewritten prompt for the user to accept or discard before any generation runs. The polish request is itself a billable model call: dissatisfaction discards the text but never refunds the spend, and the tool description plus studio copy state this so the model and the user both hear it before choosing to polish.

**Generated media lands in the wallpaper store; imports are JPEG/PNG only.** `/api/wallpaper/generate` calls `ctx.mediaGen`, stores the returned bytes as media blobs in the extended `WallpaperStore`, and returns `WallpaperItem`s marked `source: 'generated'` with `media` and `provider` set, so grid thumbnails render `<video>` for clips and the item records which vendor produced it. URL import accepts only `.jpg`/`.jpeg`/`.png` extensions (`URL_IMAGE_EXT`), the file picker sets `accept=".jpg,.jpeg,.png"`, and both paths reject everything else with a named error instead of trusting content-type sniffing. The studio surface — dropzone, generate panel, controls, thumbnails, polish result — is styled with the liquid-glass treatment: translucent `color-mix` backgrounds, `backdrop-filter: blur(24px) saturate(180%)`, hairline borders, and paired inset highlights.

## Alternatives considered

**One hard-coded provider per capability (the previous state).** Rejected because it turns a missing key into a dead feature; ordered fallback degrades to whichever vendor the user actually pays for, and the pool order still puts the product's preferred Volcengine defaults first.

**Polish inside the generation call.** Rejected because it hides a billable model request inside another billable request and removes the user's chance to reject a bad rewrite before image or video spend; the separate step costs one round-trip and gives back the confirmation the non-refund rule requires.

**Client-side file-type sniffing for imports.** Rejected because the server owns the library format contract; the extension check at the API boundary plus the `accept` attribute on the picker fail loud at the point of entry rather than after upload.

**Expand the video pool by guessing request formats for other vendors.** Rejected because unverified wire contracts fail at runtime with real money; two verified providers with a closed pool and a named error for the rest is the honest surface until each addition is tested.

## Consequences

A deployment needs only one image key and one video key from the pools to generate both kinds, at the cost of maintaining four adapter files whose per-provider quirks (ARK polling, DashScope task ids, MiniMax group id) live behind one `ResolvedProvider` discriminated union. Adding a video provider means editing `VIDEO_PROVIDERS` and its `PROVIDER_KEY_ENV` entry — the closed pool is what makes the pinned-invalid error checkable. Polish spend is untracked by this repo beyond the ordinary llm billing path; the no-refund behavior is a stated product rule, not a mechanism here. Coverage is keyless: package contract tests pin provider-ordering failures (missing env names, image-only pinned for video) and the polish flow (happy path, empty idea, disabled config, `EMPTY_RESPONSE`) against a scripted llm stream. Neither package is wired into a runnable example yet, so no assembled-application transcript snapshot exists for the studio flow — the first example that mounts `ui-wallpaper` owes one, and real-API verification of each vendor's wire contract remains e2e territory for when keys are present.
