# Test Infrastructure (`TEST_INFRA.md`)

## Overview
- **Project**: 总编剧 · 剧本工作台 — 可替换 Markdown 提示词（Skill）插件体系与多类型上传升级
- **Test Runner & Runtime**: Node.js ESM (`v24.18.0`+, zero external test-runner dependencies) using the lightweight `node:module` `register()` TS-extensionless hook (aligned with `tests/e2e-verify.mjs`).
- **Methodology**: Requirement-driven **4-tier opaque-box E2E verification** derived strictly from `ORIGINAL_REQUEST.md` (R1–R3), `PROJECT.md` (§ Interface Contracts & Feature Inventory F1–F8), `AGENTS.md`, and `docs/界面验收契约.md`.
- **LLM & Network Isolation**: Outbound LLM provider HTTP calls are intercepted via a deterministic `globalThis.fetch` mock that captures outbound `messages` / `systemInstruction` payloads so tests assert exact server-side prompt composition and injection without external API keys or network calls.
- **State Isolation & Cleanup**: Before executing, the E2E suite snapshots `.data/studio-store.json` and `.data/buckets/` state and restores/removes test artifacts in a `finally` block so repeated runs leave zero residual store or bucket pollution.

---

## 4-Tier Opaque-Box Testing Methodology

| Tier | Focus | Verification Scope |
|------|-------|--------------------|
| **Tier 1 — Feature Coverage** | Primary happy-path behavior & interface contracts | Admin `.md`/`.txt` plugin upload (JSON & `FormData`), multi-plugin per slot, `replace`, `toggle`, `set_default`, `delete`; 4-workflow slot topology (`transcribe` 1 slot; `domestic`/`foreign`/`original` primary+secondary); creator `promptCatalog` (summary-only); `create` with `promptSelections`; `set_prompts` switching; built-in fallback; mocked `fetch` asserting actual `.md`/`.txt` injection into LLM system prompt; multi-type upload (`FormData` + raw binary) + >20 MB upload + UTF-8 `filename*=` download. |
| **Tier 2 — Boundary & Corner Cases** | Edge cases, malformed inputs, concurrency & limits | Uppercase `.MD`/`.TXT` + UTF-8 BOM (`\uFEFF`) stripping; binary/null-byte & empty/whitespace plugin rejection; unsupported plugin extension rejection; `transcribe` rejecting `secondary` slot across admin & studio APIs; disabled/deleted plugin graceful fallback; stale `version` `409 CONFLICT` on `set_prompts`; >200 MB upload returning `413 FILE_TOO_LARGE`; diverse upload extensions (`.pdf`, `.srt`, `.mov`, `.csv`, `.json`, extensionless); locked episode immutability across prompt switches; non-admin access control on `/api/admin`. |
| **Tier 3 — Cross-Feature Interactions** | Multi-step workflows across modules | End-to-end flow: admin upload -> creator `create` -> LLM call with injected primary+secondary -> mid-project `set_prompts` -> next LLM call uses updated prompt -> `GET /api/upload?export=1` sanitized; `transcribe` -> `transfer_iteration` -> `foreign`/`domestic` slot selection; `switch_kind` + `set_prompts` -> LLM execution; `replace_skill_plugin` hot reload into next LLM call; multi-account isolation with shared `promptCatalog`. |
| **Tier 4 — Real-World Scenarios & Redline Audits** | Realistic production workflows & security/redline invariants | Full 4-workflow studio scenarios (`foreign` continuation with locked episodes, `domestic` 3-gates, `transcribe` mode-required video还原, `original` no-upfront-total Stop A) + strict redline leak audit verifying absence of `content`, `rawMarkdown`, `systemPrompt`, model names, route names, token counts, `OPENAI_API_KEY`, `STUDIO_BACKEND_URL`, `GPT`, and `Grok Bot` across creator APIs, `export=1` `.md`, and `app/page.tsx` UI source. |

---

## Feature Inventory Mapping (`PROJECT.md` F1–F8)

| Feature ID | Feature Name | Covered By Test IDs |
|------------|--------------|---------------------|
| **F1** | Skill Plugin Schema, Store Migration & Fallback Resolver | `T1-05`, `T1-09`, `T1-10`, `T2-04`, `T2-05`, `T2-06` |
| **F2** | Admin Skill Plugin API (`/api/admin`) | `T1-01`, `T1-02`, `T1-03`, `T1-04`, `T1-05`, `T2-01`, `T2-02`, `T2-03`, `T2-04`, `T2-11`, `T3-04` |
| **F3** | Creator Prompt Catalog, Selection & Switching API (`/api/studio`) | `T1-06`, `T1-07`, `T1-08`, `T2-04`, `T2-07`, `T2-10`, `T3-01`, `T3-02`, `T3-03`, `T3-05` |
| **F4** | Multi-Type & Relaxed-Size Upload/Export Pipeline (`/api/upload`) | `T1-11`, `T1-12`, `T2-08`, `T2-09`, `T3-01`, `T4-01`, `T4-03` |
| **F5** | Redline Sanitization Hardening | `T1-06`, `T3-01`, `T4-01`, `T4-05` |
| **F6** | Admin `/admin` Skill Plugin UI (API contract backing) | `T1-02`–`T1-05`, `T2-01`–`T2-03` |
| **F7** | Creator `/`「提示词」UI & Upload UX (API + `app/page.tsx` source redlines) | `T1-06`–`T1-08`, `T4-05` |
| **F8** | E2E & Contract Test Suite (`tests/skill-plugin-e2e.mjs`) | All Tiers (T1–T4, 33 test cases total) |

---

## Coverage Thresholds & Entry Criteria for `TEST_READY.md`
- **Minimum Tier Distribution**:
  - Tier 1 (Feature Coverage): `>= 10` tests (Actual: **12**)
  - Tier 2 (Boundary & Corner Cases): `>= 8` tests (Actual: **11**)
  - Tier 3 (Cross-Feature Interactions): `>= 4` tests (Actual: **5**)
  - Tier 4 (Real-World Scenarios & Redlines): `>= 4` tests (Actual: **5**)
- **Syntax & Static Integrity**: `node --check tests/skill-plugin-e2e.mjs` must exit `0`.
- **Execution Command**:
  - Skill Plugin & Upload E2E: `node tests/skill-plugin-e2e.mjs`
  - Full existing + contract suite: `npm.cmd test`
