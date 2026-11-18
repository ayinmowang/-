# 剧本工作台（总编剧 Story Studio）

> **⚠️ 部署与智能体读取指引（最新主版本）**：
> 本项目的最新完整代码位于 [`versions/2026-11-18-step-by-step-and-grok-bot/`](./versions/2026-11-18-step-by-step-and-grok-bot/)。任何自动部署工具或其他智能体在拉取本仓库部署时，**请直接读取并使用 `versions/2026-11-18-step-by-step-and-grok-bot/` 目录下的最新文件**（不要读取旧版 `2026-11-17` 目录或旧版 `source.zip`）：
> - 创作者纯享前台（`/`）：[`versions/2026-11-18-step-by-step-and-grok-bot/page.tsx`](./versions/2026-11-18-step-by-step-and-grok-bot/page.tsx)
> - 独立管理后台（`/admin`）：[`versions/2026-11-18-step-by-step-and-grok-bot/admin-page.tsx`](./versions/2026-11-18-step-by-step-and-grok-bot/admin-page.tsx)
> - 全局样式表：[`versions/2026-11-18-step-by-step-and-grok-bot/globals.css`](./versions/2026-11-18-step-by-step-and-grok-bot/globals.css)
> - 后端接口路由（`/api/studio`）：[`versions/2026-11-18-step-by-step-and-grok-bot/route.ts`](./versions/2026-11-18-step-by-step-and-grok-bot/route.ts)
> - 类型契约：[`versions/2026-11-18-step-by-step-and-grok-bot/types.ts`](./versions/2026-11-18-step-by-step-and-grok-bot/types.ts)

## 2026-11-18 核心特性
1. **前后台彻底分离**：创作者前台（`/`）无任何后台入口与模型名暴露；管理后台独立在 `/admin` 路由配置六大 AI 编剧工位与接口。
2. **极简空白画布 + 正在输入动效 + 逐字打字机流式输出**：默认收起右侧栏与顶部冗余横幅，先展示 `● ● ● 总编剧正在输入…` 圆点动效，再逐字打出引导语并浮现当前单步卡片。
3. **严格逐项展开（一项项来）**：扒剧（`transcribe`）按「上传视频 → 1.核对集号 → 2.选快速/详细模式（无默认） → 3.锁主角人名表 → 4.校准【待人工補寫】 → 5.下载繁简双版 Word 或转迭代」逐项推进，已完成项自动折叠为顶部绿色 `✓` 胶囊。

## 版本记录
| 日期 | 归档目录 | 状态 | 更新内容 |
| --- | --- | --- | --- |
| **2026-11-18** | [`versions/2026-11-18-step-by-step-and-grok-bot/`](./versions/2026-11-18-step-by-step-and-grok-bot/) | **★ 当前最新主版本** | 极简空白对话流、正在输入与打字机动效、五步逐项向导（一项项来）、前后台路由彻底分离（`/` 与 `/admin`）、实时工作台与输出 |
| 2026-11-17 | `versions/2026-11-17-frontend-design-direction/` | 历史归档（已弃用） | 初版三栏布局与基础设计审查 |
