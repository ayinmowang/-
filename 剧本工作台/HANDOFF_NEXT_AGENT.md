# 剧本工作台 3.0 交付总览与后续扩展指南

> **交付时间**：2026-11-19  
> **仓库地址**：`https://github.com/ayinmowang/-`（分支 `main`，部署根目录：`剧本工作台`）  
> **验收状态**：**全部通过（`npm run build` 18/18 路由 0 报错、`npm test` 4 套既有测试全绿、`tests/v3-e2e.mjs` 33/33 全绿）**

---

## 一、本次 3.0 已全部落地并验收通过的能力

1. **「暖纸墨韵」视觉壳与 6 大一级板块（M3 ✅）**：
   - `app/globals.css`、`app/layout.tsx`、`components/WarmShell.tsx`：暖宣纸浅色 + 暗色书房双主题、可折叠左侧 6 大板块导航（`创作台 /studio`、`拆书 · 扒剧 /breakdown`、`用量与额度 /usage`、`兑换 /redeem`、`个人资料 /profile`、管理员专属 `管理后台 /admin`），彻底移除「墨笔行」与公开付费菜单。
   - `app/login/page.tsx` + `components/LoginView.tsx`：水墨书房左图右卡登录页（专属 Key/邀请码、账号密码、邀请码激活）。
   - `app/usage/page.tsx`、`app/redeem/page.tsx`、`app/profile/page.tsx`：脱敏用量仪表盘（支持 CSV 导出）、邀请码/Key 兑换与工作空间切换、个人资料与全局规矩管理。
2. **「创作台」剧架大厅 + 三栏沉浸写作台（M4 ✅）**：
   - `app/page.tsx` + `app/studio/page.tsx` + `components/StudioWorkspace.tsx`：
     - 我的剧架大厅（暖色 Hero、新建作品、搜索、排序、网格/列表切换）；
     - 左栏 `[目录 ▾]` 4 项下拉资产树（作品目录含 `🔒` 前 N 集锁集只读保护 / 大纲 / 角色 / 背景设定）；
     - 中栏三行式剧作工具区（`灵感` / `一键排版` / `AI率查询` / `扫榜` / `拆书` / `本地导入` / `导出真 .docx Word` + 历史版本快照回滚 + `页宽正文`）；
     - 右栏 3 大 Tab（`创作台`含 2×2 快捷指令卡与实时读秒等待条 / `技能`脱敏卡片流 / `设定`全局与本剧规则）+ 底部双排控制栏（脱敏 `创作档位 ▾` / `⚡ 推理强度 ▾` / `📝 自动模式 ↔ 📋 计划模式`）。
3. **「拆书 · 扒剧」独立专区 + 真 `.docx` 直出 + 去限制提速（M1–M4 ✅）**：
   - `app/breakdown/page.tsx` + `components/BreakdownWorkspace.tsx`：与主创作台一致的暖纸剧架 + 三栏布局；模式卡彻底移除「待拍板事项」与「补充或修改意见」文本框，取消第 3 步空确认卡；无异常直接交付可下载真 `.docx` Word（`lib/docx.ts` 纯 Node OpenXML 生成器，`/api/upload?id=...&export=docx`），聊天区简洁员工汇报口吻不刷屏 Markdown，支持一键转入「国外迭代 / 国内迭代」。
   - `lib/server.ts` + `app/api/upload/route.ts`：流式写盘放开扒剧大视频上限至 4 GB（无 `ffmpeg` 时超大视频自动降级提取容器元数据/字幕）；新增 **Key-模型族亲和缓存** 与 `/v1/models` 缓存提速。
4. **管理后台档位映射扩展（M4 ✅）**：
   - `app/admin/page.tsx`：完整保留原有 5 大 Tab，新增 **「6. 创作档位配置」Tab**（调用 `save_creation_tiers` 维护极速档/标准档/深度精修档与底层通道/模型映射，前台完全脱敏）。

---

## 二、后续可选迭代方向（供下一位智能体继续打磨）

当前 3.0 全部核心与 P1 需求已闭环，后续如继续打磨可优先考虑：
1. **移动端自适应抽屉增强**：在 `< 960px` 窄屏下为三栏工作台的左栏与右栏增加一键抽屉切换按钮。
2. **多集并发扒剧进度条**：单次上传 10+ 集视频时，在界面显示逐集并行还原进度与一键打包分集 `.zip`。
3. **浏览器侧大视频关键帧抽取**：在无服务端 `ffmpeg` 的纯云端部署下，利用浏览器 `<video> + <canvas>` 自动对 >30 MB 视频抽取关键帧送入视觉工位。
4. **流式打字机输出（SSE）**：将右栏对话和正文续写升级为 Server-Sent Events 逐字流式吐出，进一步缩短首字等待感知。

> 注意：任何后续修改均须遵守 `app/page.tsx` 静态红线与 `.data/studio-store.json` 备份恢复原则，并通过 `npm test && node tests/v3-e2e.mjs && npm run build`。
