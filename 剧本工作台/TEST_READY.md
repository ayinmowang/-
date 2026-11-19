# 3.0 E2E Test Suite Ready (`TEST_READY.md`)

The opaque-box 4-tier E2E test suite for **剧本工作台 3.0 融合升级** is syntax-verified and ready for M1–M4 implementation verification and M5 final acceptance.

## Test Artifacts
- `TEST_INFRA.md` — 4-tier opaque-box methodology (`ORIGINAL_REQUEST.md` R1–R4 + `PROJECT.md` Interface Contracts), `F1`–`F22` Feature Inventory mapping, `.data/` `%TEMP%` protection protocol, and coverage thresholds.
- `tests/v3-e2e.mjs` — Standalone Node.js ESM 4-tier E2E test suite (33 test cases) using the `node:module` `register()` TS-extensionless hook (compatible with Node v24 without extra dependencies), pure-Node ZIP/OpenXML `.docx` parser, deterministic `globalThis.fetch` mocks, and `os.tmpdir()` `.data/studio-store.json` + `.data/buckets/` backup/restore in `try { ... } finally { ... }`.

## How to Run
```powershell
# Run the 3.0 4-Tier E2E Suite (self-contained os.tmpdir() store/bucket backup & restore)
node tests/v3-e2e.mjs

# Run existing 4-suite baseline (always wrap .data/ in %TEMP% backup/restore)
npm.cmd test

# Production build check
npm.cmd run build
```

## Syntax & Baseline Integrity Check
- `node --check tests/v3-e2e.mjs` -> **PASS** (exit code `0`).
- `.data/studio-store.json` verified untouched (`https://code28.ccwu.cc/v1` with `2` API keys intact).
- Note: M1–M4 implementation milestones are currently pending; `tests/v3-e2e.mjs` is authored against `ORIGINAL_REQUEST.md` R1–R4 and `PROJECT.md` Interface Contracts for execution after M1–M4 complete.

## Tier 1–4 Test Coverage Summary (33 Total Tests)

| Tier | Description | Test Count | Test IDs |
|------|-------------|------------|----------|
| **Tier 1** | Feature Coverage (6 routes + no `墨笔行`/SaaS menus + warm CSS, `save_creation_tiers`, desensitized `tierCatalog`, `thinkingLevel` & `executionMode`, asset trees + `episodes`/`snapshots`, `/breakdown` minimal UI, clean `transcribe` auto-deliver, `lib/docx.ts` + `?export=docx` OpenXML & `?export=1` MD, unconstrained streaming upload + >30 MB degradation, Key-model-family affinity cache, `/api/usage` model-free, `/api/redeem`, `/api/profile`, `studio_tool`) | **14** | `T1-01` – `T1-14` |
| **Tier 2** | Boundary & Negative Cases (invalid/disabled tier IDs, `plan` mode writeback block, locked episode edit/delete rejection, missing episode & anomaly confirmation card, empty/corrupt `.docx` resilience, non-admin `/api/admin` `save_creation_tiers` rejection, `thinkingLevel` boundaries, `studio_tool` `ai_rate` <120 chars & unknown tool, `STUDIO_MAX_UPLOAD_MB` dynamic cap, `/api/usage`/`/api/redeem`/`/api/profile` auth & validation) | **10** | `T2-01` – `T2-10` |
| **Tier 3** | Cross-Feature Pairwise (Breakdown -> `.docx` -> `transfer_iteration` `foreign`/`domestic`, `creationTier` + `thinkingLevel` + Skill plugin + `globalRules` + `projectRules` pairwise, `plan` -> `auto` writeback transition, multi-station `/api/usage` sanitization, Key affinity + provider 503 failover) | **5** | `T3-01` – `T3-05` |
| **Tier 4** | Real-World E2E Scenarios & Redlines (Multi-episode breakdown -> ZIP/OpenXML `.docx` parse -> transfer -> locked continuation, legacy `T4-03` confirm guard + `?export=1` compatibility, comprehensive creator redline leak audit across 3.0 APIs & `.docx`, static redlines on `app/page.tsx` & `app/admin/page.tsx`) | **4** | `T4-01` – `T4-04` |
| **Total** | | **33** | |
