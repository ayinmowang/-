# Project: 剧本工作台 3.0 融合升级（暖纸墨韵 · 独立拆书扒剧 · 档位脱敏 · 真 Docx 直出）

## Architecture
Next.js 14.2.35 App Router full-stack application (`"type": "module"`, custom CSS design system in `app/globals.css`, shared UI components in `components/`, App Router pages `/`, `/login`, `/studio`, `/breakdown`, `/usage`, `/redeem`, `/profile`, `/admin`, REST API routes under `app/api/**`, domain types in `lib/types.ts`, OpenXML `.docx` builder in `lib/docx.ts`, and persistent store + 6-station LLM orchestration in `lib/server.ts` backed by `.data/studio-store.json` and `.data/buckets/`).

### Key Architectural Pillars
1. **暖纸墨韵 · 东方书房美学 Visual Shell (`app/globals.css`, `components/WarmShell.tsx`)**:
   - Warm rice-paper light palette (`#F9F6F0` canvas, `#F4EFE6` sidebar, `#FFFFFF`/`#FAF7F2` cards, `#E6DFD3` borders, `#8C3B2B` cinnabar accent, `#D49B54` ochre-gold primary CTA, `#2C2420` ink text) with dark study-room toggle (`🌙`/`☀️`), serif display titles, and `prefers-reduced-motion` support.
   - Unified collapsible left navigation (6 top-level sections: `创作台` `/studio`, `拆书 · 扒剧` `/breakdown`, `用量与额度` `/usage`, `兑换 / 邀请码` `/redeem`, `个人资料` `/profile`, and admin-only `管理后台` `/admin`) + unified top bar (`← 返回剧架` + editable title, `🔔`, `🌙`, `💧 $XX.XX 可用`, avatar dropdown).
   - Zero occurrences of 「墨笔行」 or public SaaS billing menus (`充值/会员`, `我的订阅`, `我的订单`, `游戏收益`, `定价`).
   - Left-ink-landscape + right-card `/login` page supporting Key/Invite login, Username/Password login, and Invite registration.
2. **创作台 (`/studio` & `/`) Three-Column Workbench + Desensitized Tiers**:
   - **Bookshelf Hall**: Hero card (`My Bookshelf` / `我的剧架`), `+ 新建作品` & `↓ 导入本地剧本`, search/sort/grid-list toggle, project cards with quick actions.
   - **Left Panel (`目录 ▾`)**: 4-mode switcher (`作品目录` with volume/episode tree & `🔒 锁定` read-only protection, `大纲`, `角色`, `背景设定`).
   - **Center Panel**: 3-row toolbar: Row 1 P1 creative tools (`💡 灵感`, `✨ 一键排版`, `🔍 AI率查询`, `🔥 扫榜`, `📖 拆书`, `📥 本地导入`, `📄 导出 Word`), Row 2 chapter/title/word-count/`历史版本`/sync/save/delete, Row 3 formatting + `页宽正文` reading width.
   - **Right Panel (`创作台 / 技能 / 设定`)**: `创作台` chat (employee-to-boss tone, live elapsed timer, focused decision cards), `技能` (desensitized `.md/.txt` Skill cards — name & short summary only), `设定` (global & project rules + `.txt/.md` import), and 2-row bottom bar (`+ 添加 Skill`, `📎 上传文件`, `🎤 语音输入`, `↑ 发送 / ⏹ 停止` + desensitized `创作档位 ▾` / `⚡ 推理 ▾` / `📝 自动模式 ↔ 📋 计划模式`).
   - **Critical Static Redline**: `app/page.tsx` renders the shared entry/studio experience and **must** pass all static checks (`tests/skill-plugin-e2e.mjs` `T4-05` & `tests/tier5-adversarial.mjs` `T5-R1`/`T5-R2`): NO `/\bgpt/i`, `/Grok[\s-]?Bot/i`, `OPENAI_API_KEY`, `STUDIO_BACKEND_URL`, `rawMarkdown`, `systemPrompt`, `20 MB`, `20 * 1024 * 1024`; MUST KEEP `'提示词'`, `'BUDGET_EXCEEDED'`, `'SLOT_NOT_ALLOWED'`, `'ACCOUNT_DISABLED'`, `'已停用或已移除的提示词'`.
3. **拆书 · 扒剧 (`/breakdown`) Independent Zone + Minimal Direct `.docx` + Acceleration**:
   - Replaces 「墨笔行」 with a dedicated bookshelf + 3-column workbench visually identical to `/studio`, supporting video breakdown (`transcribe`), book/manuscript breakdown, and one-click transfer to `/studio` (`transfer_iteration`).
   - **Minimal UX**: Mode card contains ONLY `⚡ 快速模式` and `🔍 详细模式` (removes `待拍板事项` and `补充或修改意见` textareas); eliminates empty Step 3 confirmation card (`card-transcribe-verify-*`) when no anomaly exists; delivers directly (`status: 'delivered'`) with concise employee-to-boss report + downloadable real `.docx` card (NO massive Markdown dump in chat); only pops confirmation card on real anomaly/missing episode/conflict.
   - **Pure-Node `.docx` Builder (`lib/docx.ts`)**: Uses Node `node:zlib` (`deflateRawSync`, `crc32`) to emit valid ZIP/OpenXML (`PK\x03\x04`) short-drama `.docx` via `?export=docx` (preserving `?export=1` Markdown for existing tests!).
   - **Unconstrained Video + No-`ffmpeg` Graceful Degradation**: Streaming disk write to `.data/buckets/` removes small-file traps; `<= 30 MB` videos go multimodal directly; `> 30 MB` videos use pure-JS MP4 container metadata + paired `.srt`/`.txt` subtitles + optional browser-side `<video><canvas>` keyframe extraction without requiring `ffmpeg`/`ffprobe`.
   - **Key-Model-Family Affinity Cache & Speedup (`lib/server.ts`)**: Caches API Key ↔ model-family affinity and `/v1/models` lists, adds `AbortController` timeouts, passes `tool_choice: 'none'` (with fallback), and supports bounded concurrent multi-episode execution.
4. **Admin Tier Mapping (`/admin`) & Existing Capabilities**:
   - Retains all 5 existing tabs (`accounts`, `providers`, `routes`, `monitor`, `skills`) and required error strings (`BINARY_CONTENT_REJECTED`, `INVALID_PLUGIN_FILE_TYPE`), plus adds **创作档位配置 (`tiers`)** mapping desensitized presets (`极速档 0.5x`, `标准档 1x`, `深度精修档 2x`) to stations/providers/models/thinking capability.
5. **`.data/studio-store.json` & Compatibility Guardrails**:
   - Relative-path ESM imports & erasable TypeScript in `lib/**` and `app/api/**` (Node v24 TS loader compatibility).
   - Mandatory `%TEMP%` backup/restore around every `npm.cmd test` execution so `https://code28.ccwu.cc/v1` and the 2 real API keys in `.data/studio-store.json` remain 100% intact.

---

## Feature Inventory
Every feature from the Step 0 Survey (`F1`–`F22` + `E1`–`E8`) is assigned to a milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Remove 「墨笔行」 & Public SaaS Billing Menus | Remove 墨笔行, 充值/会员, 我的订阅, 我的订单, 游戏收益, 定价 from all nav/menus/views | M3, M4 | R1, Spec §3.1 |
| F2 | 6 Top-Level Routes & Auth Shell | `/studio`, `/breakdown`, `/usage`, `/redeem`, `/profile`, `/admin` (admin-only), plus `/login` and `/` | M3, M4 | R1, Spec §3.2 |
| F3 | Unified Top Status Bar | `← 返回剧架` + editable title, `🔔`, `🌙/☀️`, `💧 $XX.XX 可用`, avatar menu | M3 | R1, Spec §2.4 |
| F4 | 「暖纸墨韵」 Design System | Warm paper light palette + dark study mode, serif display headers, `页宽正文`, `prefers-reduced-motion`, 390/917/1440 responsive | M3 | R1, 界面契约 |
| F5 | Left-Image-Right-Card `/login` | Ink landscape left panel + 3-tab right card (`专属 Key/邀请码`, `账号密码`, `邀请码注册`) | M3 | R1, `01-login.png` |
| F6 | `/studio` Bookshelf Hall | Warm Hero card, `+ 新建作品`, `↓ 导入本地剧本`, search/sort/grid-list, create modal, project cards | M4 | R2, `03-studio.png` |
| F7 | `/studio` Left Asset Tree (`目录 ▾`) & Lock Protection | 4-mode switcher (`作品目录`/`大纲`/`角色`/`背景设定`), volume/episode CRUD, read-only `🔒` locked episodes | M1, M2, M4 | R2, Spec §4.2 |
| F8 | `/studio` Center 3-Row Toolbar & Editor | Row 1 enhancement capsules, Row 2 chapter/version snapshots/sync/save/delete, Row 3 formatting & `页宽正文` | M1, M2, M4 | R2, Spec §4.2 |
| F9 | `/studio` Right 3 Tabs (`创作台 / 技能 / 设定`) | Chat + 2x2 quick cards + employee tone + timer; desensitized Skill cards; global/project rules + `.txt/.md` import | M2, M4 | R2, Spec §4.2 |
| F10 | `/studio` Bottom 2-Row Controls (Tiers / Thinking / Auto-Plan) | Desensitized `创作档位 ▾` (zero model names), `⚡ 推理 ▾`, `📝 自动模式 / 📋 计划模式`, attachments/voice/send/stop | M1, M2, M4 | R2, `12-ai-model-dropdown.png` |
| F11 | `/breakdown` Bookshelf & 3-Column Workbench | Dedicated `拆书 · 扒剧` zone matching `/studio` 3-column visuals, video + book breakdown | M4 | R3, Spec §5.1-5.2 |
| F12 | Minimal Video Breakdown UX & Employee Tone | Remove `待拍板事项` & `补充或修改意见` textareas, eliminate Step 3 empty confirmation card, direct `.docx` card, concise employee-to-boss chat, anomaly-only confirmation | M2, M4 | R3, Spec §5.2 |
| F13 | Real OpenXML `.docx` Generation (`lib/docx.ts`) | Pure-Node `zlib` OpenXML `.docx` (`PK\x03\x04`) via `?export=docx` (keeping `?export=1` Markdown compatible) | M1, M2 | R3, Spec §5.3 |
| F14 | Unconstrained Video Upload & Large-Video Degradation | Streaming disk write to `.data/buckets/`, remove small upload caps, pure-JS MP4 metadata + subtitle + browser keyframe fallback without `ffmpeg` | M1, M2, M4 | R3, Spec §5.3 |
| F15 | Key-Model-Family Affinity Cache & Speedup | `keyModelFamilyCache`, 5-min `/models` cache, `AbortController` timeouts, `tool_choice: 'none'` fallback, bounded concurrency | M1 | R3, Spec §5.3 |
| F16 | One-Click Transfer from `/breakdown` to `/studio` | `转入创作台（国外迭代 / 国内迭代）` creating linked project & navigating to `/studio` | M2, M4 | R3, Spec §5.2 |
| F17 | `/admin` Creation Tier Mapping Config | Admin UI & `/api/admin` `save_creation_tiers` mapping presets (`极速档/标准档/深度精修档`) to station/provider/model/thinking; sanitized `tierCatalog` for frontend | M1, M2, M4 | R2, Spec §6 |
| F18 | Preserve Existing 5 Admin Tabs & 6-Station Relay | Full compatibility with `accounts`, `providers`, `routes`, `monitor`, `skills`, `BINARY_CONTENT_REJECTED`, `INVALID_PLUGIN_FILE_TYPE` | M2, M4 | R4, Spec §6 |
| F19 | `/usage` Usage & Quota Page (P1) | `GET /api/usage`: dark banner, 3+4 KPIs, 7-day trend, desensitized station/tier breakdown (no model names), log table & export | M2, M3 | R1, `04-dashboard.png` |
| F20 | `/redeem` & `/profile` Pages (P1) | Invite/Key redemption workspace switcher + profile card, password update, global rules, theme preference | M2, M3 | R1, `13-profile.png` |
| F21 | `/studio` Phase 3 Enhancement Tools (P1) | `灵感`, `一键排版`, `AI率查询`, `扫榜` (10+ platforms with reliable fallback), `拆书` quick modal, `本地导入`, `导出 Word` | M2, M4 | R1, `06-09` shots |
| F22 | Redline, `.data/` Backup/Restore, Tests & GitHub Sync | Static `app/page.tsx` redline compliance, `%TEMP%` backup/restore around `npm.cmd test`, 3.0 E2E Tiers 1-4 + Tier 5 + Chrome 3-viewport verification, `scripts/push-to-github.mjs` | M4, E2E_TEST_ORCH, M5 | R4, 验收标准 |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|--------------|--------|
| M1 | Core Backend Engine & Pure-Node `.docx` (`lib/`) | `lib/types.ts`, `lib/docx.ts`, `lib/server.ts`: CreationTier schema & defaults, studio asset tree & snapshot types, pure-Node OpenXML `.docx` builder, Key-model-family affinity cache & `/models` TTL cache, `AbortController` timeouts, `tool_choice: 'none'` fallback, unconstrained upload defaults, `sanitizeForClient` tier/usage hardening | none | DONE (`worker_m1_2`, `reviewer_m1_2_1/2` APPROVE, `challenger_m1_2_1_r2/2` CONFIRM, `auditor_m1_2_1_r2` CLEAN) |
| M2 | API Routes Upgrade (`app/api/**`) | `app/api/admin/route.ts` (tier CRUD), `app/api/studio/route.ts` (`tierCatalog`, `thinkingLevel`, `executionMode`, minimal `transcribe` direct delivery & anomaly-only card, asset trees, snapshots, `studio_tool`, large-video >30 MB fallback), `app/api/upload/route.ts` (streaming upload + `?export=docx` keeping `?export=1`), `app/api/auth/route.ts`, `app/api/usage/route.ts`, `app/api/redeem/route.ts`, `app/api/profile/route.ts` | M1 | DONE (`worker_m2_1`, `reviewer_m2_1_1/2` APPROVE, `challenger_m2_1_1/2` CONFIRM, `auditor_m2_1_1` CLEAN) |
| M3 | 暖纸墨韵 Design System, Shell & Account Pages | `app/globals.css`, `app/layout.tsx`, `components/WarmShell.tsx`, `components/LoginView.tsx`, `app/login/page.tsx`, `app/usage/page.tsx`, `app/redeem/page.tsx`, `app/profile/page.tsx` | M2 | IN_PROGRESS |
| M4 | 创作台, 拆书·扒剧, 根路由红线兼容 & 管理后台扩展 | `components/StudioWorkspace.tsx`, `components/StudioToolsModals.tsx`, `components/BreakdownWorkspace.tsx`, `app/studio/page.tsx`, `app/breakdown/page.tsx`, `app/page.tsx` (strict static redline compliance), `app/admin/page.tsx` (add Creation Tiers tab & shell link, preserve 5 tabs & required strings) | M3 | PLANNED |
| E2E_TEST_ORCH | 3.0 E2E Testing Track (Opaque-Box Tiers 1–4) | Update `TEST_INFRA.md`, write requirement-driven 3.0 E2E suite `tests/v3-e2e.mjs` (covering 6-section nav, no 墨笔行/SaaS menus, `/login`, `/studio` 3-col + tiers + lock, `/breakdown` minimal UX + `.docx` PK/OpenXML check + no Markdown chat dump + large video, Key affinity cache, `/admin` tiers, `/usage`/`/redeem`/`/profile`, redlines, `%TEMP%` store safety), publish v3.0 `TEST_READY.md` | none (runs parallel with M1–M4) | DONE (`TEST_READY.md`, 33 tests, `node --check` 0) |
| M5 | Final Milestone: E2E Pass (Tiers 1–4), Tier 5 Adversarial, Browser Verification & GitHub Push | Phase 1: wrap `.data/` in `%TEMP%` backup/restore, run `npm.cmd test` (all 4 existing suites) + `npm.cmd run build` + `tests/v3-e2e.mjs` until 100% pass; Phase 2: Tier 5 Adversarial (`Challenger -> Worker -> Reviewer`) + Chrome/Edge 3-viewport (`390x844`, `917x893`, `1440x900`) real render check; Phase 3: verify `.data/studio-store.json` (`https://code28.ccwu.cc/v1` + 2 keys intact) and push to `main` via `scripts/push-to-github.mjs` | M4, E2E_TEST_ORCH | PLANNED |

---

## Interface Contracts

### 1. Creation Tiers, Execution Controls & Assets (`lib/types.ts`)
- `ThinkingLevel = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'`
- `ExecutionMode = 'auto' | 'plan'`
- `CreationTierConfig`: `{ id, name, badge, description, costHint, station, providerId?, model?, temperature?, maxTokens?, supportsThinking, enabled, isDefault, order }`
- `CreatorTierSummary`: `{ id, name, badge, description, costHint, supportsThinking, isDefault }` (NEVER contains `model`, `providerId`, `baseUrl`, `apiKey`, `systemPrompt`)
- `Project` adds:
  - `volumes?: StudioVolume[]` (`id`, `title`, `order`)
  - `episodes?: StudioEpisode[]` (`id`, `volumeId?`, `episodeNumber`, `title`, `body`, `locked`, `updatedAt`, `snapshots?`) — uses `body` (not `content`) to avoid colliding with `isAllowedContentPath` redline tests
  - `outlineNodes?: StudioAssetNode[]`, `characterNodes?: StudioAssetNode[]`, `worldNodes?: StudioAssetNode[]` (using `body` field)
  - `projectRules?: string`
  - `preferredTierId?: string`, `thinkingLevel?: ThinkingLevel`, `executionMode?: ExecutionMode`
- `StudioAccount` adds `globalRules?: string`, `themePreference?: 'light' | 'dark'`.
- `AdminSystemConfig` adds `creationTiers?: CreationTierConfig[]`.

### 2. Pure-Node OpenXML `.docx` (`lib/docx.ts`) & Export (`app/api/upload/route.ts`)
- `buildDocxBuffer(input: { title: string; subtitle?: string; synopsis?: string; characters?: string; sections: Array<{ heading: string; body: string; locked?: boolean }>; meta?: Record<string, string> }): Buffer`
  - Generates valid ZIP archive (`PK\x03\x04`, `word/document.xml`, `[Content_Types].xml`, `_rels/.rels`, `word/_rels/document.xml.rels`, `word/styles.xml`) using `node:zlib` (`deflateRawSync`, `crc32`).
- `GET /api/upload?id=...&export=1`: **MUST preserve** existing sanitized UTF-8 Markdown response for `tests/e2e-verify.mjs`, `tests/skill-plugin-e2e.mjs`, and `tests/tier5-adversarial.mjs`.
- `GET /api/upload?id=...&export=docx` (or `format=docx`): returns binary `.docx` buffer with `Content-Type: application/vnd.openxmlformats-officedocument.wordprocessingml.document`, `Content-Disposition: attachment; filename="script.docx"; filename*=UTF-8''...`.

### 3. Minimal Video Breakdown (`transcribe`) Contract (`app/api/studio/route.ts`)
- Mode selection card (`mode_select`) presents ONLY `fast` / `detailed` modes (no `decisions` / `feedback` textareas in UI).
- When `action: 'confirm'` runs `transcribe` with `mode` (`fast` | `detailed`) and all attached videos have valid resolved episode numbers and no recognition anomalies:
  - Backend executes breakdown, populates structured `outputs` + `outlineNodes`/`characterNodes`/`episodes` + `.docx` ready artifact, records a concise employee-to-boss delivery message (NO massive raw Markdown dump in chat), and sets `remote.status = 'delivered'`, `remote.card = null` (skipping the empty Step 3 confirmation card!).
  - Backward-compatibility guard: if an automated legacy test (`T4-03`) subsequently sends `{ action: 'confirm', answers: { boundaries: ... } }` when `kind === 'transcribe'` and `remote.status === 'delivered'` and `remote.card === null`, handle it cleanly and return `{ ok: true, project }` without corrupting `delivered` state.
- When an actual anomaly occurs (missing/ambiguous episode number, empty/unreadable video without paired transcript when >30 MB and no keyframes, or character conflict), emit a focused anomaly confirmation card (`card-transcribe-anomaly`) with concise employee-to-boss explanation.

### 4. Key-Model-Family Affinity Cache & Streaming Upload (`lib/server.ts`, `app/api/upload/route.ts`)
- `lib/server.ts` maintains `keyModelFamilyCache` (`Map<string, { supportedFamilies: Set<string>; unsupportedFamilies: Set<string>; models?: string[]; updatedAt: number }>`) and `/models` 5-min cache. Keys matching the target model family (`gpt` / `gemini` / `claude` / `deepseek` / etc.) are prioritized first in `callStationLLM`; `model_not_found` / `No available channel for model` updates negative affinity immediately.
- `getMaxUploadBytes(kind?: Kind)`: Strictly honors `process.env.STUDIO_MAX_UPLOAD_MB` when set (`T5-U1`); when unset, returns `4096 * 1024 * 1024` (4 GB streaming video support) for `kind === 'transcribe'` and `200 * 1024 * 1024` for non-transcribe legacy flows (preserving `T2-08` `201 MB -> 413`). Raw binary uploads stream `request.body` directly to `.data/buckets/` via `fs.createWriteStream`.

### 5. Static Redlines (`app/page.tsx`, `app/admin/page.tsx`)
- `app/page.tsx` MUST NOT match `/\bgpt/i`, `/Grok[\s-]?Bot/i`, `OPENAI_API_KEY`, `STUDIO_BACKEND_URL`, `rawMarkdown`, `systemPrompt`, `20 MB`, `20 * 1024 * 1024`.
- `app/page.tsx` MUST contain `'提示词'`, `'BUDGET_EXCEEDED'`, `'SLOT_NOT_ALLOWED'`, `'ACCOUNT_DISABLED'`, `'已停用或已移除的提示词'`.
- `app/admin/page.tsx` MUST contain `'BINARY_CONTENT_REJECTED'`, `'INVALID_PLUGIN_FILE_TYPE'`.

---

## Code Layout
- `lib/types.ts` — Shared TypeScript types, CreationTier types, asset/episode/thinking/mode types
- `lib/docx.ts` — Pure-Node OpenXML `.docx` ZIP generator
- `lib/server.ts` — Store persistence, auth/session, `sanitizeForClient`, Skill resolver, Key-model-family affinity cache, `callStationLLM`
- `app/api/auth/route.ts` — Login, invite registration, logout, session
- `app/api/admin/route.ts` — Admin CRUD, providers, 6-station routes, Skill plugins, Creation Tiers
- `app/api/studio/route.ts` — Projects, workflows, minimal `transcribe`, asset/episode updates, `studio_tool`, `tierCatalog`
- `app/api/upload/route.ts` — Streaming upload, attachment download, `?export=1` (MD) & `?export=docx` (OpenXML `.docx`)
- `app/api/usage/route.ts` — Account/admin usage & quota analytics (model-free)
- `app/api/redeem/route.ts` — Invite/key redemption & workspace switch
- `app/api/profile/route.ts` — Profile edit, password change, global rules, theme preference
- `app/globals.css` & `app/layout.tsx` — 「暖纸墨韵」 design tokens, dark mode, responsive & a11y styles
- `components/WarmShell.tsx` — Unified 6-section sidebar + top status bar
- `components/LoginView.tsx` — Left-ink-right-card login/register view
- `components/StudioWorkspace.tsx` & `components/StudioToolsModals.tsx` — Bookshelf + 3-col studio + P1 tools
- `components/BreakdownWorkspace.tsx` — Independent `/breakdown` bookshelf + 3-col video/book workbench
- `app/page.tsx`, `app/login/page.tsx`, `app/studio/page.tsx`, `app/breakdown/page.tsx`, `app/usage/page.tsx`, `app/redeem/page.tsx`, `app/profile/page.tsx`, `app/admin/page.tsx` — Next.js App Router pages
- `tests/` — Existing 4 suites (`studio.test.mjs`, `e2e-verify.mjs`, `skill-plugin-e2e.mjs`, `tier5-adversarial.mjs`) + new `tests/v3-e2e.mjs`
- `scripts/push-to-github.mjs` — Gitless GitHub REST push to `ayinmowang/-` (`main`)
