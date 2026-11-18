# E2E Test Suite Ready (`TEST_READY.md`)

The opaque-box 4-tier E2E test suite for the Skill plugin system, 4-workflow slot architecture, multi-type & 200 MB upload pipeline, LLM prompt injection/fallback, and strict redline sanitization is ready for M4 verification.

## Test Artifacts
- `TEST_INFRA.md` — 4-tier opaque-box methodology, `PROJECT.md` Feature Inventory mapping (F1–F8), and coverage thresholds.
- `tests/skill-plugin-e2e.mjs` — Node.js ESM E2E test suite using the `node:module` TS-extensionless hook (compatible with Node v24 without extra test dependencies) and deterministic mocked `fetch` + automatic `.data/` restoration.

## How to Run
```powershell
# Run the Skill Plugin, Upload & Redline E2E suite
node tests/skill-plugin-e2e.mjs

# Run existing contract & multi-account E2E tests
npm.cmd test
```

## Syntax & Baseline Check
- `node --check tests/skill-plugin-e2e.mjs` -> **PASS** (exit code `0`).
- `node tests/studio.test.mjs` -> **PASS** (`ALL_CONTRACT_TESTS_PASSED`).
- Pre-M1/M2/M3 dry run of `node tests/skill-plugin-e2e.mjs` executed cleanly with `6 passed, 27 failed` (expected failures on unimplemented M1–M3 contracts) and `.data/` completely cleaned up (`Test-Path .data` -> `False`).

## Tier 1–4 Test Coverage Summary (33 Total Tests)

| Tier | Description | Test Count | Test IDs |
|------|-------------|------------|----------|
| **Tier 1** | Feature Coverage (admin `.md`/`.txt` CRUD, 4-flow slot topology, `promptCatalog`, `create`/`set_prompts`, fallback, LLM injection, >20 MB upload, UTF-8 `filename*=`) | **12** | `T1-01` – `T1-12` |
| **Tier 2** | Boundary & Corner Cases (`.MD`/`.TXT` + UTF-8 BOM, binary/empty/ext rejection, `transcribe` rejecting `secondary`, disabled/deleted fallback, `409` stale version, `413` >200 MB, diverse formats, locked episode immutability, non-admin guard) | **11** | `T2-01` – `T2-11` |
| **Tier 3** | Cross-Feature Interactions (upload->create->inject->switch->export, `transcribe`->`transfer_iteration`->slots, `switch_kind`+`set_prompts`, `replace_skill_plugin` hot reload, multi-account catalog/isolation) | **5** | `T3-01` – `T3-05` |
| **Tier 4** | Real-World Scenarios & Redline Audits (4 end-to-end workflow runs + strict redline leak audit on creator APIs, `export=1` `.md`, and `app/page.tsx` UI source) | **5** | `T4-01` – `T4-05` |
| **Total** | | **33** | |
