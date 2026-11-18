# Project: 总编剧 · 剧本工作台 — 可替换 Markdown 提示词（Skill）插件体系与多类型上传升级

## Architecture
Next.js 14 App Router monolith (`app/page.tsx` creator 3-column studio at `/`, `app/admin/page.tsx` admin console at `/admin`, REST endpoints under `app/api/{auth,admin,studio,upload}/route.ts`, shared domain types in `lib/types.ts`, persistence & LLM orchestration in `lib/server.ts` backed by `.data/studio-store.json` and `.data/buckets/`).

### Key Architectural Changes
1. **Skill Plugin Registry & Slot Architecture**:
   - Store Skill plugins (`.md` primary, `.txt` compatible) in `AdminSystemConfig.skillPlugins` (`.data/studio-store.json`), supporting multiple plugins per `(kind, slot)` with `enabled`, `isDefault`, `name`, `description`, `content`, `fileName`, `updatedAt`.
   - Workflow slot topology (preserving exact 4 workflow names):
     - `transcribe` (扒剧): 1 slot (`primary` only; `secondary` forbidden).
     - `domestic` (国内迭代国外): 2 slots (`primary`, `secondary`).
     - `foreign` (国外迭代国外): 2 slots (`primary`, `secondary`).
     - `original` (原创): 2 slots (`primary`, `secondary`).
   - **Resolution & Fallback**: For any workflow run, resolve `project.promptSelections[kind][slot]` -> verify exists & `enabled` -> else fall back to slot's `isDefault && enabled` plugin -> else `null` (automatically fall back to built-in station `systemPrompt` and workflow rules). When active plugin(s) resolve, inject primary (+ secondary if applicable) `.md`/`.txt` prompt content into `callStationLLM` via `systemPromptOverride` / composed station prompt.
2. **Strict Creator-Side Redline Sanitization**:
   - Single unified `sanitizeForClient` in `lib/server.ts` used across `/api/studio`, `/api/upload?export=1`, and error payloads.
   - Creator-facing endpoints (`/api/studio`) expose ONLY `{ id, kind, slot, name, description, isDefault }` under `promptCatalog` — never raw `.md`/`.txt` content, `fileName`, `systemPrompt`, model names, route names, or tokens.
   - Remove all `GPT`, `Grok Bot`, `OPENAI_API_KEY`, `STUDIO_BACKEND_URL`, and literal key leaks from creator UI (`app/page.tsx`) and creator API messages (`app/api/studio/route.ts`).
3. **Upload Compatibility & Size Relaxation**:
   - Raise upload limit from 20 MB to 200 MB (`MAX_UPLOAD_BYTES = 200 * 1024 * 1024`, overridable via `STUDIO_MAX_UPLOAD_MB` env) on both client (`app/page.tsx`) and server (`app/api/upload/route.ts`).
   - Remove/bound unbounded `memoryBucket` heap cache in `lib/server.ts` so large uploads stream/persist to `.data/buckets/` without Node OOM.
   - Broaden client `<input type="file" accept=...>` and support both raw binary & `multipart/form-data` uploads, plus UTF-8/BOM decoding for `.md`/`.txt` Skill plugins and `filename*=` on attachment downloads.

---

## Feature Inventory
Every feature from Survey & `ORIGINAL_REQUEST.md` (R1–R6) is assigned a milestone below:

| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| F1 | Skill Plugin Schema, Store Migration & Fallback Resolver | `SkillPluginRecord`, `CreatorPromptSummary`, `PromptSlotKey`, store migration, slot rules (`transcribe` 1 slot, others 2), fallback chain, LLM prompt composition | M1 | R1, R2, Survey |
| F2 | Admin Skill Plugin API (`/api/admin`) | Upload (`.md`/`.txt`), replace, enable/disable, set default, delete, multi-plugin per slot, UTF-8/BOM decoding, corrupt/binary rejection | M2 | R1, Survey |
| F3 | Creator Prompt Catalog, Selection & Switching API (`/api/studio`) | Creator-safe `promptCatalog` (name + short description only), create-time `promptSelections`, in-project `set_prompts`, `switch_kind` fix | M2 | R2, R3, Survey |
| F4 | Multi-Type & Relaxed-Size Upload/Export Pipeline | Raise 20 MB -> 200 MB limit, eliminate `memoryBucket` OOM risk, support `FormData` + raw binary, broaden file types, UTF-8 `filename*`, `export=1` sanitization | M1, M2, M3 | R1, R3, Survey |
| F5 | Redline Sanitization Hardening | Unify `sanitizeForClient`, expand `SENSITIVE_KEYS` & model/provider regexes, dynamic plugin-content scrubbing, clean `GPT`/`Grok Bot`/`OPENAI_API_KEY`/`STUDIO_BACKEND_URL` strings | M1, M2, M3 | R3, AGENTS.md, Survey |
| F6 | Admin `/admin` Skill Plugin UI | 5th tab `提示词插件 (Skills)` for 4 workflows & primary/secondary slots: upload `.md`/`.txt`, replace, toggle, set default, edit metadata/content, delete | M3 | R1, Survey |
| F7 | Creator `/`「提示词」UI & Upload UX | Unified「提示词」selectors at creation (`preChat` + `create` modal) and in-project switching (`overview`, `project` modal, pre-confirm card); relaxed upload UI; 3-viewport & a11y compliance | M3 | R1, R2, R3, 界面验收契约 |
| F8 | E2E & Contract Test Suite (`tests/`) | Install deps (`npm.cmd install`), opaque-box 4-tier E2E suite covering R1–R3 + upload boundaries + fallback/injection + redline leaks; publish `TEST_READY.md` | E2E_TEST_ORCH, M4 | R1–R3, Verification |
| F9 | Integration, E2E Pass & Tier 5 Hardening | Full `npm.cmd run build` + `npm.cmd test` + E2E Tiers 1–4 pass + Tier 5 white-box adversarial coverage hardening | M4 | R1–R3, Project Pattern |
| F10 | Speed Benchmark (R4) & Improvement Proposals (R5) | Real latency/throughput benchmark on production build + >=3 backend & >=5 frontend improvement proposal report | M5 | R4, R5 |
| F11 | Version Archive & GitHub Sync (R6) | `.gitignore` blocking `.data/` & secrets, `versions/2026-11-18-skill-plugins-and-upload/` archive, commit & push to `https://github.com/ayinmowang/-.git` | M1 (`.gitignore`), M5 (Archive & Push) | R6, AGENTS.md |

---

## Milestones

| # | Name | Scope | Dependencies | Status |
|---|------|-------|--------------|--------|
| M1 | Core Schema, Skill Resolver, Bucket Fix & Sanitization (`lib/`, `.gitignore`) | `npm.cmd install`, `.gitignore`, `lib/types.ts`, `lib/server.ts` (Skill schema, migration, slot validation, fallback/injection resolver, `memoryBucket` cap, unified `sanitizeForClient`) | none | DONE (`lib/` + `.gitignore` + TS 5.8.3 verified) |
| M2 | Backend API Routes (`app/api/{admin,studio,upload}/route.ts`) | `/api/admin` plugin CRUD + `.md`/`.txt` upload; `/api/studio` `promptCatalog`, `promptSelections`, `set_prompts`, string cleanup; `/api/upload` 200 MB + `FormData` + `export=1` sanitization | M1 | DONE (`tsc` 0, `next build` 0, `npm.cmd test` 0) |
| M3 | Frontend UI (`/admin` & `/`) | `/admin` Skill plugin management tab (`app/admin/page.tsx`); `/` unified「提示词」creation/switching UI, relaxed upload, redline string cleanup (`app/page.tsx`, `app/globals.css`) | M2 | DONE (`tsc` 0, `next build` 0, Chrome 157 3-viewport CDP verified) |
| E2E_TEST_ORCH | E2E Testing Track (`tests/`, `TEST_INFRA.md`, `TEST_READY.md`) | Requirement-driven opaque-box 4-tier test suite covering R1–R3 + existing invariants; publishes `TEST_READY.md` | none (runs parallel with M1–M3) | DONE (TEST_READY.md published, 33 tests) |
| M4 | Final Milestone: E2E Pass (Tiers 1–4) & Tier 5 Hardening | Run `npm.cmd run build` & all E2E Tiers 1–4 until 100% pass; execute Tier 5 white-box adversarial hardening (`Challenger -> Worker -> Reviewer`) | M3, E2E_TEST_ORCH (`TEST_READY.md`) | IN_PROGRESS |
| M5 | Speed Benchmark (R4), Improvement Report (R5) & GitHub Sync (R6) | Real production benchmark metrics & bottleneck analysis; >=3 backend + >=5 frontend improvement report; `versions/` archive + GitHub commit & push | M4 | PLANNED |

---

## Interface Contracts

### 1. Types & Slot Rules (`lib/types.ts`)
```ts
export type PromptSlotKey = 'primary' | 'secondary';

export interface SkillPluginRecord {
  id: string;
  kind: Kind; // 'foreign' | 'domestic' | 'transcribe' | 'original'
  slot: PromptSlotKey; // 'transcribe' allows ONLY 'primary'
  name: string;
  description: string; // short creator-visible description (<= 120 chars recommended)
  content: string; // raw .md / .txt text (ADMIN + SERVER ONLY — NEVER sent to creator)
  fileName: string; // ADMIN ONLY
  fileExt: 'md' | 'txt';
  enabled: boolean;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CreatorPromptSummary {
  id: string;
  kind: Kind;
  slot: PromptSlotKey;
  name: string;
  description: string;
  isDefault: boolean;
}

export type PromptSlotSelection = {
  primary?: string; // plugin id or '' / undefined for system default/fallback
  secondary?: string; // only valid when kind !== 'transcribe'
};

export type ProjectPromptSelections = Partial<Record<Kind, PromptSlotSelection>>;
```
- `Project` adds `promptSelections?: ProjectPromptSelections`.
- `AdminSystemConfig` adds `skillPlugins?: SkillPluginRecord[]`.

### 2. Server Helpers (`lib/server.ts`)
- `MAX_UPLOAD_BYTES`: default `200 * 1024 * 1024` (200 MB), configurable via `process.env.STUDIO_MAX_UPLOAD_MB`.
- `getAllowedSlotsForKind(kind: Kind): PromptSlotKey[]`: returns `['primary']` for `'transcribe'`, `['primary', 'secondary']` otherwise.
- `buildCreatorPromptCatalog(config: AdminSystemConfig): Record<Kind, { primary: CreatorPromptSummary[]; secondary?: CreatorPromptSummary[] }>`: includes ONLY `enabled` plugins, stripped to `CreatorPromptSummary`.
- `resolveWorkflowSkillPrompts(config: AdminSystemConfig, project: Project, kind?: Kind): { primary: SkillPluginRecord | null; secondary: SkillPluginRecord | null; composedSystemPrompt: (basePrompt: string) => string }`:
  - Resolution order per allowed slot: explicit `project.promptSelections?.[kind]?.[slot]` (if exists and `enabled`) -> slot's `isDefault && enabled` plugin -> `null` (built-in fallback).
  - `composedSystemPrompt(basePrompt)` appends/integrates active primary and secondary plugin contents cleanly on the server side when present, and returns `basePrompt` unchanged when both are `null`.
- `sanitizeForClient<T>(input: T, extraSensitiveTexts?: string[]): T`: unified deep sanitizer stripping `SENSITIVE_KEYS`, model/provider/env patterns, and any active plugin raw content fingerprints.

### 3. Admin API (`app/api/admin/route.ts`)
- `GET /api/admin`: returns `systemConfig` (including `skillPlugins`) alongside existing snapshot.
- `POST /api/admin` (accepts both `application/json` and `multipart/form-data`):
  - `operation: 'upload_skill_plugin'`: `{ kind, slot, name, description, content, fileName }` (or `FormData` with `file` `.md`/`.txt`). Validates UTF-8 text (strips UTF-8 BOM), rejects non-text/binary or empty content, validates `kind` & `slot`, saves plugin, optionally sets default if `isDefault === true`.
  - `operation: 'replace_skill_plugin'`: `{ id, name?, description?, content, fileName? }` (or `FormData` with `file`).
  - `operation: 'toggle_skill_plugin'`: `{ id, enabled: boolean }`.
  - `operation: 'set_default_skill_plugin'`: `{ id, isDefault: boolean }` (unsets `isDefault` on sibling plugins in the same `(kind, slot)`).
  - `operation: 'delete_skill_plugin'`: `{ id }`.

### 4. Studio API (`app/api/studio/route.ts`)
- `GET /api/studio`: returns `promptCatalog` (strictly `CreatorPromptSummary` only) on list & single-project responses, sanitized through `sanitizeForClient`.
- `POST /api/studio`:
  - `operation: 'create'`: accepts `promptSelections?: PromptSlotSelection | ProjectPromptSelections`, validates allowed slots for `kind`, stores on `project.promptSelections`.
  - `operation: 'set_prompts'`: `{ id, version, kind?, primaryPluginId?, secondaryPluginId? }` — updates active slot prompt selection with `409 CONFLICT` on stale `version`, preserving locked episodes.
  - LLM calls in `runGptRecapIfConfigured`, `revise`, and `confirm` stage branches resolve active workflow plugins via `resolveWorkflowSkillPrompts` and pass composed prompt via `systemPromptOverride` to `callStationLLM`.

### 5. Upload & Export API (`app/api/upload/route.ts`)
- `POST /api/upload?id=...&name=...&role=...`: accepts both raw binary body AND `multipart/form-data`; enforces `MAX_UPLOAD_BYTES` (200 MB); persists directly to `.data/buckets/` without holding large files in `memoryBucket`.
- `GET /api/upload?id=...&export=1`: runs assembled Markdown through `sanitizeForClient` before returning.
- `GET /api/upload?id=...&file=...`: sets RFC 5987 `filename*=UTF-8''...` alongside ASCII fallback.

---

## Code Layout
- `lib/types.ts` — Shared TypeScript interfaces & workflow constants
- `lib/server.ts` — Persistent store, auth/session, `sanitizeForClient`, Skill resolver, `callStationLLM`
- `app/api/admin/route.ts` — Admin console API & Skill plugin CRUD
- `app/api/studio/route.ts` — Creator studio API, prompt selection & workflow execution
- `app/api/upload/route.ts` — File upload/download & Markdown export
- `app/api/auth/route.ts` — Session & login/registration API
- `app/admin/page.tsx` — Admin console UI (`/admin`)
- `app/page.tsx` — Creator 3-column studio UI (`/`)
- `app/globals.css` — Studio styles
- `tests/` — Contract & E2E verification suite (`studio.test.mjs`, `e2e-verify.mjs`, and new E2E tests)
- `docs/` — Specifications & improvement proposal report
- `versions/` — Dated iteration snapshots (excluded from TS build)
- `.gitignore` — Excludes `.data/`, `node_modules/`, `.next/`, `.env*`, `.agents/`
