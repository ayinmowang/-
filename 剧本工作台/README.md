# 剧本工作台

AI 短剧改编网站，包含聊天式建档与总编剧工作流。

## 下载和协作

- [完整源码压缩包](./source.zip)：下载并解压，包含前端、后端、测试和 `docs/`；在解压目录按 `README.md` 与 `AGENTS.md` 开始协作。
- [网站计划书](./网站计划书.md)、[项目书](./项目书.md) 和 [原始计划](./计划书_v1.md)：项目目标与已拍板决定。
- [界面验收契约](./界面验收契约.md) 与 [设计审查](./设计审查.md)：本轮交互检查依据。
- [PRO 实时工作台](./versions/2026-11-17-pro-workspace/) · [单集提取与逐集交付](./versions/2026-11-17-episode-delivery/) · [前一版交互归档](./versions/2026-11-17-frontend-design-direction/)。
- [frontend-design-direction 技能包](./frontend-design-direction.zip)：解压后保持 `frontend-design-direction/SKILL.md` 原名及目录结构，放入所用智能体支持的技能目录；在任务中写 `$frontend-design-direction` 调用。不同工具的技能安装路径以各自说明为准。

在线预览：https://director-studio-ayin.ayinx.chatgpt.site/

部署时在解压目录参照 `README.md` 配置环境变量；不要提交真实密钥、素材或数据库。
## 版本记录
| 日期 | 归档目录 | 更新内容 |
| --- | --- | --- |
| 2026-11-18 | [第 8 版 · 建档与交付修复](./versions/2026-11-18-workflow-contracts/) | 续写锁定稿、原创停点 A、管理员预算与重试、文字试写和 Word 交付 |
| 2026-11-18 | `versions/2026-11-18-step-by-step-and-grok-bot/` | 升级极简空白对话流、正在输入与打字机动效、逐项单步向导（一项项来）、移除前端费用审批卡、新增 Grok Bot 参谋建议、Apple HIG 实时工作页面与 `/admin` 后台 |
