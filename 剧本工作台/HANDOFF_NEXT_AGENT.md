
# 剧本工作台 3.0 交付总览与后续扩展指南

> **交付时间**：2026-11-19  
> **仓库地址**：`[https://github.com/ayinmowang/-](https://github.com/ayinmowang/-)`（分支 `main`，部署根目录：`剧本工作台`）  
> **验收状态**：**3.0 M1–M4 已完成；商业化扩展第 1 步范围已实现（第 2–6 步未开始），本步测试与构建以验收命令 `npm test && node tests/commerce-migration.mjs && node tests/v3-e2e.mjs && npm run build` 为准**

---

## 一、已落地能力总览

1. **「暖纸墨韵」视觉壳与 9 项一级导航（M3 ✅ + Step1 商业化扩展 ✅）**：
   - `app/globals.css`、`app/layout.tsx`、`components/WarmShell.tsx`：暖宣纸浅色 + 暗色书房双主题、可折叠左侧 9 项一级导航（顺序：`创作台 /studio`、`拆书 · 扒剧 /breakdown`、`用量与额度 /usage`、`我的订阅 /subscriptions`、`充值 / 会员 /purchase`、`我的订单 /orders`、`兑换 / 邀请码 /redeem`、`个人资料 /profile`、管理员专属 `管理后台 /admin`），仅禁止「墨笔行」与「游戏收益」。
   - `app/login/page.tsx` + `components/LoginView.tsx`：水墨书房左图右卡登录页（专属码/邀请码、账号密码、邀请码激活）。
   - `app/usage/page.tsx`、`app/redeem/page.tsx`、`app/profile/page.tsx`：脱敏用量仪表盘（支持 CSV 导出）、邀请码/专属码兑换与工作空间切换、个人资料与全局规矩管理。
2. **商业化订阅 / 充值 / 订单与后台入账闭环（Step1 商业化扩展 ✅，2–6 步未开始）**：
   - **Store 兼容迁移**：兼容旧版 store 数据结构，增量扩展 `plans`、`subscriptions`、`orders` 字段，确保升级迁移过程中完整保留既有账号与额度配置（`budgetCapUsd` / `budgetUsedUsd`）。
   - **三页与对应 API**：新增 `我的订阅 /subscriptions`、`充值 / 会员 /purchase`、`我的订单 /orders` 页面及后端 API；支持发起订单、查询记录与取消订阅（取消订阅仅停止后续自动续订，不回扣已入账的 `budgetCapUsd`）。
   - **管理后台扩展与支付预留**：`app/admin/page.tsx` 完整保留原有 6 个 Tab，新增套餐价格与额度管理能力，以及管理员确认入账操作（具备管理员鉴权、账号归属校验、幂等防双充、金额与额度正数校验及并发锁保护）；支付渠道仅预留扩展槽位，暂不接入真钱第三方支付网关。
3. **「创作台」剧架大厅 + 三栏沉浸写作台（M4 ✅）**：
   - `app/page.tsx` + `app/studio/page.tsx` + `components/StudioWorkspace.tsx`：
     - 我的剧架大厅（暖色 Hero、新建作品、搜索、排序、网格/列表切换）；
     - 左栏 `[目录 ▾]` 4 项下拉资产树（作品目录含 `🔒` 前 N 集锁集只读保护 / 大纲 / 角色 / 背景设定）；
     - 中栏三行式剧作工具区（`灵感` / `一键排版` / `AI率查询` / `扫榜` / `拆书` / `本地导入` / `导出真 .docx Word` + 历史版本快照回滚 + `页宽正文`）；
     - 右栏 3 大 Tab（`创作台`含 2×2 快捷指令卡与实时读秒等待条 / `技能`脱敏卡片流 / `设定`全局与本剧规则）+ 底部双排控制栏（脱敏 `创作档位 ▾` / `⚡ 推理强度 ▾` / `📝 自动模式 ↔ 📋 计划模式`）。
4. **「拆书 · 扒剧」独立专区 + 真 `.docx` 直出 + 去限制提速（M1–M4 ✅）**：
   - `app/breakdown/page.tsx` + `components/BreakdownWorkspace.tsx`：与主创作台一致的暖纸剧架 + 三栏布局；模式卡彻底移除「待拍板事项」与「补充或修改意见」文本框，取消第 3 步空确认卡；无异常直接交付可下载真 `.docx` Word（`lib/docx.ts` 纯 Node OpenXML 生成器，`/api/upload?id=...&export=docx`），聊天区简洁员工汇报口吻不刷屏 Markdown，支持一键转入「国外迭代 / 国内迭代」。
   - `lib/server.ts` + `app/api/upload/route.ts`：流式写盘放开扒剧大视频上限至 4 GB（无 `ffmpeg` 时超大视频自动降级提取容器元数据/字幕）；新增连接亲和缓存与模型列表缓存提速。
5. **管理后台 6 大基础 Tab 与扩展能力（M4 ✅ + Step1 ✅）**：
   - `app/admin/page.tsx`：完整保留原有 5 大基础 Tab 与第 6 Tab「创作档位配置」（维护极速档/标准档/深度精修档与底层通道映射，前台完全脱敏），并集成商业化套餐价格额度管理与管理员确认入账功能。

---

## 二、测试与验收说明

- **保留既有测试**：原有 4 套 `npm test` 套件全部保留。
- **新增与更新套件**：
  - `tests/commerce-migration.mjs`：使用隔离夹具验证旧 store 向 `plans` / `subscriptions` / `orders` 兼容迁移及既有账号额度无损保留。
  - `tests/v3-e2e.mjs`：`T1-01` 更新为校验左侧 9 项导航顺序、仅禁止「墨笔行」与「游戏收益」，并覆盖 `/subscriptions`、`/purchase`、`/orders` 三路由及对应 API（含取消订阅不回扣、管理员确认入账幂等/正数校验）。
- **本步标准验收命令**：
  ```bash
  npm test && node tests/commerce-migration.mjs && node tests/v3-e2e.mjs && npm run build
  ```
  > 注：第 1 步商业化范围已实现，最终通过状态以执行上述验收命令的实际输出为准。

---

## 三、后续迭代方向（第 2–6 步及体验打磨）

当前商业化扩展第 1 步已落地，第 2–6 步尚未开始，后续可按以下方向推进：
1. **商业化第 2–6 步深化**：按规划逐步推进套餐权益细化、自动化续订调度、真实支付渠道扩展槽对接、财务对账报表与多级分销/邀请返佣闭环。
2. **移动端自适应抽屉增强**：在 `< 960px` 窄屏下为三栏工作台的左栏与右栏增加一键抽屉切换按钮。
3. **多集并发扒剧进度条**：单次上传 10+ 集视频时，在界面显示逐集并行还原进度与一键打包分集 `.zip`。
4. **浏览器侧大视频关键帧抽取**：在无服务端 `ffmpeg` 的纯云端部署下，利用浏览器 `<video> + <canvas>` 自动对 >30 MB 视频抽取关键帧送入视觉工位。
5. **流式打字机输出（SSE）**：将右栏对话和正文续写升级为 Server-Sent Events 逐字流式吐出，进一步缩短首字等待感知。

> 注意：任何后续修改均须遵守 `app/page.tsx` 静态红线与 `.data/studio-store.json` 备份恢复原则，并通过 `npm test && node tests/commerce-migration.mjs && node tests/v3-e2e.mjs && npm run build`。
