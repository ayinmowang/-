# 总编剧网站 · 界面与建档复查（2026-11-17）

对应 Sites 源码提交：`bd16fbad548ffd8badf7fdac6af0b512886763f8`。完整源码在[项目根目录的 source.zip](../../source.zip)，解压后包含前端、后端、测试与 `docs/`。

本轮改动：显式选择流程、纯素材建档、上传进度与失败重试、窄屏资料面板默认收起、建档核对与 AI 复述区分、集号修改和无障碍反馈。

同目录的文件对应源码路径：

| 归档文件 | 源码路径 |
| --- | --- |
| `route.ts` | `app/api/studio/route.ts` |
| `globals.css` | `app/globals.css` |
| `page.tsx` | `app/page.tsx` |
| `界面验收契约.md` | `docs/界面验收契约.md` |
| `设计审查.md` | `docs/设计审查.md` |

验证：TypeScript 检查、Vinext 生产构建通过。实际浏览器渲染的三个目标视口截图验收待做；GPT 创作后端尚未连接。

协作前请先读项目根目录的《计划书_v1.md》《项目书.md》，以及源码包中的 `AGENTS.md`。不要提交真实素材、数据库或密钥。
