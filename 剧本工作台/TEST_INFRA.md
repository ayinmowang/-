# Test Infrastructure (`TEST_INFRA.md`)

## Overview
- **Project**: 剧本工作台 3.0 融合升级（暖纸墨韵 · 独立拆书扒剧 · 档位脱敏 · 真 Docx 直出）
- **Test Runner & Runtime**: Node.js ESM (`v24.18.0`+, zero external test-runner dependencies) using the lightweight `node:module` `register()` TS-extensionless hook (aligned with `tests/skill-plugin-e2e.mjs` and `tests/tier5-adversarial.mjs`).
- **Methodology**: Requirement-driven **4-tier opaque-box E2E verification** derived strictly from `ORIGINAL_REQUEST.md` (R1–R4), `PROJECT.md` (§ Architecture, Feature Inventory F1–F22 & Interface Contracts), `界面验收契约.md`, and `.agents/teamwork/teamwork_spec_miner_survey_1/spec_report.md`.
- **LLM & Network Isolation**: Outbound LLM provider HTTP calls (`/chat/completions`, `/models`, `:generateContent`) are intercepted via deterministic `globalThis.fetch` mocks to assert prompt composition, `thinkingLevel` / `executionMode` handling, Key-model-family affinity caching, and redline sanitization without external API calls or token spend.
- **`.data/` Self-Protection (`os.tmpdir()` Backup & Restore)**:
  - Before any store/bucket mutation, `tests/v3-e2e.mjs` copies `.data/studio-store.json` and `.data/buckets/` to a unique `fs.mkdtempSync(path.join(os.tmpdir(), 'studio-v3-e2e-backup-'))` directory.
  - Inside `try { ... } finally { ... }`, it restores exact store & bucket contents, deletes `globalThis.__STUDIO_PERSISTENT_STORE__`, restores `globalThis.fetch` and env vars, verifies SHA-256 parity, and explicitly verifies `https://code28.ccwu.cc/v1` + its 2 real API keys remain intact (never printing raw keys).

---

## 4-Tier Opaque-Box Testing Methodology

| Tier | Focus | Verification Scope |
|------|-------|--------------------|
| **Tier 1 — Feature Coverage** | Primary happy-path behavior & 3.0 interface contracts (Category-Partition) | R1 navigation/shell/routes (6 top-level routes `/studio`, `/breakdown`, `/usage`, `/redeem`, `/profile`, `/admin` + `/login`, zero `墨笔行`/`充值/会员`/`我的订阅`/`我的订单`/`游戏收益`, warm paper CSS tokens); R2 `/api/admin` `save_creation_tiers`, desensitized `tierCatalog` (zero `model`/`providerId`/`baseUrl`/`systemPrompt`), `thinkingLevel` & `executionMode` (`plan`/`auto`), asset trees (`outlineNodes`/`characterNodes`/`worldNodes`), `episodes` + `snapshots` + locked protection; R3 `/breakdown` minimal UX (no `待拍板事项`/`补充或修改意见`, no empty Step 3 `card-transcribe-verify-*` on clean breakdown, concise employee-to-boss tone, no raw Markdown chat dump), pure-Node OpenXML `.docx` (`PK\x03\x04`, valid deflate entries `[Content_Types].xml`, `word/document.xml`, locked preservation) via `?export=docx` while keeping `?export=1` Markdown, streaming unconstrained upload (>20 MB & >30 MB fallback without `ffmpeg`), Key-model-family affinity cache; R1 P1 `/api/usage` (zero model names), `/api/redeem`, `/api/profile`, `studio_tool`. |
| **Tier 2 — Boundary & Corner Cases** | Boundary Value Analysis, negative cases & access control | Invalid/disabled creation tier IDs; `plan` mode refusing episode/asset writeback; locked episode edit & delete rejection (`400`/`403`); missing/ambiguous episode number in `transcribe` & anomaly-only confirmation card (`card-transcribe-anomaly`) instead of silent delivery; empty/corrupt `.docx` upload & empty-project `.docx` export resilience; non-admin `/api/admin` `save_creation_tiers` rejection (`401`/`403`); invalid `thinkingLevel` & `supportsThinking: false` handling; `studio_tool` `ai_rate` <120 chars & unknown tool rejection; `STUDIO_MAX_UPLOAD_MB` dynamic cap preservation; `/api/usage`, `/api/redeem`, `/api/profile` auth & validation boundaries. |
| **Tier 3 — Cross-Feature Pairwise** | Multi-module pairwise workflows | Breakdown -> `.docx` export -> `transfer_iteration` to `/studio` `foreign`/`domestic`; `creationTier` + `thinkingLevel` + Skill plugin + `globalRules` + `projectRules` pairwise injection & redline scrubbing; `plan` -> `auto` mode writeback transition; multi-station `/api/usage` recording with zero model name leaks; Key-model-family affinity + provider failover interaction. |
| **Tier 4 — Real-World E2E Scenarios & Redlines** | End-to-end production scenarios & static/runtime redline invariants | Multi-episode short drama breakdown (clean auto-deliver -> real ZIP/OpenXML `.docx` parse -> `transfer_iteration` -> locked continuation); legacy `T4-03` confirm compatibility & `?export=1` Markdown check; comprehensive creator redline leak audit across all 3.0 APIs & `.docx`; static redline checks on `app/page.tsx`, `app/admin/page.tsx`, and all 3.0 routes/components. |

---

## Feature Inventory Mapping (`PROJECT.md` F1–F22)

| Feature ID | Feature Name | Covered By 3.0 E2E Test IDs |
|---|---|---|
| **F1** | Remove 「墨笔行」 & Public SaaS Billing Menus | `T1-01`, `T4-04` |
| **F2** | 6 Top-Level Routes & Auth Shell | `T1-01`, `T2-06`, `T4-04` |
| **F3** | Unified Top Status Bar | `T1-01`, `T4-04` |
| **F4** | 「暖纸墨韵」 Design System | `T1-01`, `T4-04` |
| **F5** | Left-Image-Right-Card `/login` | `T1-01`, `T4-04` |
| **F6** | `/studio` Bookshelf Hall | `T1-01`, `T4-04` |
| **F7** | `/studio` Left Asset Tree (`目录 ▾`) & Lock Protection | `T1-05`, `T2-02`, `T2-03`, `T4-01` |
| **F8** | `/studio` Center 3-Row Toolbar & Editor | `T1-05`, `T1-08`, `T1-14`, `T2-03` |
| **F9** | `/studio` Right 3 Tabs (`创作台 / 技能 / 设定`) | `T1-13`, `T3-02`, `T4-03` |
| **F10** | `/studio` Bottom 2-Row Controls (Tiers / Thinking / Auto-Plan) | `T1-03`, `T1-04`, `T2-01`, `T2-02`, `T2-07`, `T3-02`, `T3-03` |
| **F11** | `/breakdown` Bookshelf & 3-Column Workbench | `T1-01`, `T1-06`, `T4-04` |
| **F12** | Minimal Video Breakdown UX & Employee Tone | `T1-06`, `T1-07`, `T2-04`, `T4-01`, `T4-02` |
| **F13** | Real OpenXML `.docx` Generation (`lib/docx.ts`) | `T1-08`, `T2-05`, `T3-01`, `T4-01`, `T4-02`, `T4-03` |
| **F14** | Unconstrained Video Upload & Large-Video Degradation | `T1-09`, `T2-05`, `T2-09` |
| **F15** | Key-Model-Family Affinity Cache & Speedup | `T1-10`, `T3-05` |
| **F16** | One-Click Transfer from `/breakdown` to `/studio` | `T3-01`, `T4-01` |
| **F17** | `/admin` Creation Tier Mapping Config | `T1-02`, `T1-03`, `T2-01`, `T2-06` |
| **F18** | Preserve Existing 5 Admin Tabs & 6-Station Relay | `T1-02`, `T4-04` |
| **F19** | `/usage` Usage & Quota Page (P1) | `T1-11`, `T2-10`, `T3-04`, `T4-03` |
| **F20** | `/redeem` & `/profile` Pages (P1) | `T1-12`, `T1-13`, `T2-10`, `T3-02` |
| **F21** | `/studio` Phase 3 Enhancement Tools (`studio_tool`, P1) | `T1-14`, `T2-08` |
| **F22** | Redline, `.data/` Backup/Restore & Compatibility | Self-Protection `finally` block, `T4-02`, `T4-03`, `T4-04` |

---

## Coverage Thresholds & Entry Criteria for `TEST_READY.md`
- **Minimum Tier Distribution**:
  - Tier 1 (Feature Coverage): `>= 12` tests (Actual: **14** — `T1-01` to `T1-14`)
  - Tier 2 (Boundary & Negative Cases): `>= 8` tests (Actual: **10** — `T2-01` to `T2-10`)
  - Tier 3 (Cross-Feature Pairwise): `>= 4` tests (Actual: **5** — `T3-01` to `T3-05`)
  - Tier 4 (Real-World E2E Scenarios & Redlines): `>= 4` tests (Actual: **4** — `T4-01` to `T4-04`)
- **Total 3.0 E2E Tests**: **33** (`tests/v3-e2e.mjs`).
- **Syntax & Static Integrity**: `node --check tests/v3-e2e.mjs` must exit `0`.
- **Execution Commands**:
  - 3.0 E2E Suite: `node tests/v3-e2e.mjs`
  - Existing 4-Suite Baseline (always wrap `.data/` in `%TEMP%` backup/restore): `npm.cmd test`
  - Production Build: `npm.cmd run build`
