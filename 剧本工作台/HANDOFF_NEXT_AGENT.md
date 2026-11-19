# 剧本工作台 3.0 交接文档与下一步规划（供后续智能体直接接手）

> **交接时间**：2026-11-19  
> **仓库地址**：`https://github.com/ayinmowang/-`（分支 `main`，代码根目录 `剧本工作台/`）  
> **当前构建状态**：`npm run build` **通过（退出码 0，13/13 路由编译成功）**；后端 M1 + M2 全票验收通过，现有 4 套自动化测试基线全绿，本地 `.data/studio-store.json` 真实中转配置（`https://code28.ccwu.cc/v1` 与 2 个 API Key）完好无损。

---

## 一、已完成并验收通过的部分（可直接复用，勿重复造轮子）

### 1. 架构规划与测试基线（100% 完成）
- `docs/剧本工作台3.0融合升级规划方案.md`：逐按钮、逐下拉菜单、逐弹窗的完整 3.0 融合蓝图（对标源炙创作台视觉与三栏布局 + 独立「拆书·扒剧」专区）。
- `docs/设计说明与细节理念.md`：产品理念、四类流程、红线安全体系说明。
- `PROJECT.md`：工程级架构契约、F1–F22 功能清单与 M1–M5 里程碑拆解。
- `tests/v3-e2e.mjs` + `TEST_INFRA.md` + `TEST_READY.md`：已写好的 **33 项 3.0 专项端到端测试套件**（内置 `%TEMP%` `.data/studio-store.json` 自动备份/恢复机制，可直接运行验证后续前端与全链路改造）。

### 2. M1 核心后端引擎与纯 Node 真 `.docx`（✅ 100% 完成并通过 5 项审查/对抗/审计）
- `lib/types.ts`：已完整扩展 3.0 类型定义：`ThinkingLevel`、`ExecutionMode`、`CreationTierConfig`、`CreatorTierSummary`、`StudioVolume`、`StudioEpisode`（含 `snapshots` 历史版本与 `locked` 锁集保护）、`StudioAssetNode`（大纲/角色/背景设定）以及 `StudioAccount.globalRules/themePreference`。
- `lib/docx.ts`（649 行）：纯 Node `node:zlib`（`deflateRawSync` + `crc32`）OpenXML `.docx` Word 生成器，输出标准 ZIP/OpenXML 二进制文件（`PK\x03\x04`）并内置客户端红线脱敏。
- `lib/server.ts`：
  - 新增 **Key-模型族亲和缓存（`keyModelFamilyCache`）** 与 5 分钟 `/v1/models` 缓存，消除多 Key 分组试错延迟；
  - 新增 `AbortController` 超时保护与 `tool_choice: 'none'` 自动重试防误调工具；
  - 新增 `creationTiers` 默认档位配置（极速档 0.5x / 标准档 1x / 深度精修档 2x）及客户端脱敏 `buildCreatorTierCatalog`；
  - 新增 `getMaxUploadBytes(kind)`：扒剧流程默认放开至 4 GB 流式上传，其他流程保持 200 MB（严格兼容 `STUDIO_MAX_UPLOAD_MB` 环境变量与现有 `T2-08`/`T5-U1` 测试）。

### 3. M2 全套 7 个后端 API 路由（✅ 100% 完成并通过 5/5 审查/对抗/审计）
- `app/api/upload/route.ts`：磁盘流式上传到 `.data/buckets/`；新增 `?export=docx` 输出真 `.docx` Word 文件（同时保留 `?export=1` Markdown 兼容现有测试）。
- `app/api/studio/route.ts`：
  - 返回脱敏 `tierCatalog`、`thinkingLevel`、`executionMode`；
  - 扒剧（`transcribe`）无异常时直接交付（`remote.status = 'delivered'`, `remote.card = null`），聊天框仅输出简洁员工汇报口吻 + `.docx` 下载卡片，不刷屏大段 Markdown；遇真实异常时才弹出聚焦异常卡；
  - 支持资产树增删改（分卷/分集/历史版本快照回滚/大纲/角色/背景设定）、`projectRules`、以及 `studio_tool`（灵感 / 一键排版 / AI率查询 / 扫榜 / 拆书）接口；
  - 超大视频（>30 MB）在无 `ffmpeg` 时自动降级提取 MP4 元数据 + 配套字幕或前端关键帧。
- `app/api/admin/route.ts`：新增 `save_creation_tiers` 创作档位与六大工位/模型映射配置接口，完整保留原有全部功能。
- `app/api/usage/route.ts`（新增）：脱敏用量统计（KPI、近 7 天趋势、调用明细、CSV 导出，绝不暴露模型名）。
- `app/api/redeem/route.ts`（新增）：专属 Key / 邀请码兑换与工作空间切换。
- `app/api/profile/route.ts`（新增）：个人资料、改密、全局规矩 `globalRules` 与浅/暗主题偏好保存。
- `app/api/auth/route.ts`：已适配新登录与会话逻辑。

### 4. M3 暖纸墨韵视觉系统与基础外壳（🟡 已完成约 60%，编译全绿）
已完成并编译通过：
- `app/globals.css`（1974 行）：完整「暖纸墨韵」浅色宣纸 + 暗色书房 CSS Token 体系与响应式样式。
- `app/layout.tsx`：全站根布局与主题初始化。
- `components/WarmShell.tsx`（633 行）：左侧可折叠 6 大板块导航（`创作台 /studio`、`拆书·扒剧 /breakdown`、`用量与额度 /usage`、`兑换 /redeem`、`个人资料 /profile`、管理员专属 `管理后台 /admin`）+ 顶部统一状态栏（彻底清除「墨笔行」及公开付费菜单）。
- `components/LoginView.tsx` + `app/login/page.tsx`：左图右卡水墨书房登录页（支持专属 Key/邀请码、账号密码、邀请码注册）。

---

## 二、下一步规划（供下一个智能体直接按序接手完成）

后续智能体只需按以下 **3 个清晰步骤** 依次推进即可完整收官 3.0：

### 步骤 1：收尾 M3 剩余 3 个账号板块页面（预计改动 3 个文件）
1. **`app/usage/page.tsx`**：套用 `WarmShell`，对接 `GET /api/usage`，展示深色概览横幅、3+4 KPI 卡片、近 7 天趋势图、脱敏工位/档位分布（严禁模型名）及明细表与导出按钮。
2. **`app/redeem/page.tsx`**：套用 `WarmShell`，对接 `POST /api/redeem`，实现专属 Key / 邀请码输入激活与工作空间一键切换。
3. **`app/profile/page.tsx`**：套用 `WarmShell`，对接 `GET/POST /api/profile`，实现昵称/密码修改、`全局规矩`（`globalRules`，支持导入 `.txt/.md`）编辑与浅/暗主题切换。

### 步骤 2：完成 M4 核心工作台页面与管理后台档位 Tab（预计改动 7 个文件）
1. **`components/StudioToolsModals.tsx`**：实现中栏 6 大增强弹窗（`💡 灵感`、`✨ 一键排版`、`🔍 AI率查询（人工率/疑似AI率双进度条）`、`🔥 扫榜（10+平台）`、`📖 拆书快捷分析`、`📥 本地导入`）。
2. **`components/StudioWorkspace.tsx` + `app/studio/page.tsx`**：
   - 第一层：「我的剧架」暖纸 Hero 大厅（`+ 新建作品`、`↓ 导入本地剧本`、搜索/排序/网格与列表视图切换）；
   - 第二层：三栏沉浸写作台：
     - 左栏：顶部 `[目录 ▾]` 下拉切换（`作品目录`含卷章树与 `🔒` 锁集只读保护 / `大纲` / `角色` / `背景设定`）+ 动态新建按钮；
     - 中栏：三行式工具区（增强胶囊排 + 章节切换/字数/历史版本回滚/保存/导出真 `.docx` + 撤销/重做/加粗/斜体/「」/对齐/`页宽正文`）；
     - 右栏：3 大 Tab（`创作台`含 2×2 快捷指令卡与实时读秒等待条 / `技能`脱敏卡片流 / `设定`全局与本剧规则）+ 底部双排控制栏（`+ Skill`/`📎`/`🎤`/`↑` + 脱敏 `创作档位 ▾` / `⚡ 推理 ▾` / `📝 自动模式 ↔ 📋 计划模式`）。
3. **`components/BreakdownWorkspace.tsx` + `app/breakdown/page.tsx`**：
   - 独立 **`拆书 · 扒剧`** 专区（替换「墨笔行」），视觉与三栏格式与 `/studio` 高度统一；
   - 扒剧模式卡**仅保留**「⚡ 快速模式 / 🔍 详细模式」两张卡与主按钮（**无** `待拍板事项` 与 `补充或修改意见` 文本框，**无** 第 3 步空确认卡）；
   - 扒剧完成直接展示可下载真 `.docx` 卡片（`/api/upload?id=...&export=docx`），聊天区仅简洁员工汇报口吻，正文同步进中栏页宽预览，并支持「一键转入创作台（国外迭代 / 国内迭代）」。
4. **`app/page.tsx`**：接入新外壳与 `StudioWorkspace`（或重定向/渲染主剧架），**务必严格满足静态红线检查**（见下方第三节）。
5. **`app/admin/page.tsx`**：完整保留原有 5 个 Tab 及必需错误码文案，新增 **「创作档位配置」Tab**（调用 `save_creation_tiers` 维护极速/标准/精修档与六大工位/模型映射），顶部补充返回前台工作台入口。

### 步骤 3：M5 全量验收、真实中转联调与 GitHub 推送
1. **先备份 `.data/studio-store.json`** 到 `%TEMP%`（保护用户的 `https://code28.ccwu.cc/v1` 与 2 个真实 API Key）！
2. 依次运行并确保 100% 通过：
   - `npm.cmd test`（全部 4 套现有测试：`studio.test.mjs`, `e2e-verify.mjs`, `skill-plugin-e2e.mjs`, `tier5-adversarial.mjs`）
   - `node tests/v3-e2e.mjs`（33 项 3.0 专项测试）
   - `npm.cmd run build`
3. 恢复 `%TEMP%` 备份的 `.data/studio-store.json` 并核对 `https://code28.ccwu.cc/v1` 与 2 个 Key 完好无损。
4. 使用本地无头 Chrome 对 `/login`、`/studio`、`/breakdown`、`/usage`、`/admin` 做多视口渲染抽查（`390×844` / `917×893` / `1440×900`）。
5. 使用同步脚本推送至 GitHub `main` 分支：
   ```bash
   node scripts/push-to-github.mjs "<GITHUB_TOKEN>" "feat: complete 3.0 warm-paper studio, breakdown module, and docx export"
   ```

---

## 三、接手必读的 3 条硬红线（切勿踩坑）

1. **`app/page.tsx` 静态红线**（`T4-05`、`T5-R1`、`T5-R2` 强校验）：
   - **严禁出现**：`/\bgpt/i`、`/Grok[\s-]?Bot/i`、`OPENAI_API_KEY`、`STUDIO_BACKEND_URL`、`rawMarkdown`、`systemPrompt`、`20 MB`、`20 * 1024 * 1024`。
   - **必须保留**：`'提示词'`、`'BUDGET_EXCEEDED'`、`'SLOT_NOT_ALLOWED'`、`'ACCOUNT_DISABLED'`、`'已停用或已移除的提示词'`。
2. **`app/admin/page.tsx` 静态契约**：必须保留 `'BINARY_CONTENT_REJECTED'` 与 `'INVALID_PLUGIN_FILE_TYPE'`。
3. **数据保护**：运行任何测试前先备份 `.data/studio-store.json`，测完立刻还原；GitHub 推送脚本 `scripts/push-to-github.mjs` 会自动排除 `.data/` 与 `.env*`，切勿手动提交密钥。
