# 23:11授权：已存真实正文恢复结果

更新时间：2026-11-22T23:25:59.239159+08:00（北京时间，Asia/Shanghai）。本轮结果不是新的视频生成，也不是视听准确性验收。

## 已形成正常交付数据
- 目标：`112087e5-3b44-4e55-872a-2ceb45046c00`，标题「真实复验·不再被宠坏01·快速模式·1723」，owner ayin。
- 原action `74c267ba-2489-4de4-a480-1a0cd2e776bb`。23:20北京时间，已通过模型生成的锁定恢复工具 dry-run→备份→apply；项目 **failed/version6 → delivered/version7**，正确源第1集。不是手填episodes，不是fixture，不伪造供应商新成功。
- 原17:27真实返回的逻辑文本仍私存，SHA256 `835f3ebf7a5058f2f191ee6eb882a1ceabdf26e6fc91aee361513ab4414c5117` 未变；目录0700，raw与meta0600，无链接。没有声称这是完整wire SSE。
- 生产parser/prepare/merge/guard/安全保存路径实际执行。简体正文1542字，独立繁体序列1548字（含集标题），均9场，不拼接重复集。恢复来源审计明确为 saved-response offline recovery；原业务audit仍仅1条。重复apply实际拒绝且store未变；其他项目、账号和sessions在恢复时不变。旧 d5a2…项目未改。
- 当前持久层不再有旧 transcribeDraft；正常owner GET200、匿名401、跨owner404，Word同样401/404。正常API、消息和Word检查未见完整raw、私存路径、原audit/线路等后台字段。

## 真实HTTP与交付文件（不是mock）
- 源Word正常GET200，实际7264字节，SHA256 `3d7f57a179c5d800c8c2660ae3cd50ac78a0b3e6296f607be7e76f25c3ca3da1`。**已解压 `word/document.xml`**：主版场次1-1…1-9；附「附：繁體版分集劇本」亦1-1…1-9，含对白，无未清洗三段raw标题或私密字段。
- 文件：`recovery_2311/delivery/ep01-recovered-bilingual.docx`；XML与抽取文本同目录。当前持久正文：`ep01-simplified.md`、`ep01-traditional-serialized.md`；均来自正常owner GET而非参考稿。
- 已按原定**仅一次**正常API转入国外目标：`ee47c465-001a-48bb-ba46-ee8b4d217807`，标题「真实复验·不再被宠坏01·快速模式·1723（国外迭代）」。POST201，目标正文与源逐字一致，目标Word200且9场。源row/version/正文和业务audit均未变化。既有transfer契约只复制主版episodes，繁体仍保留在源项目及源Word；没有谎称目标双版齐全。
- **确认的新残余：转入目标的附件元数据被复制，但实际下载HTTP200/0字节（标示6070606字节）**。源视频仍实际6070606字节、hash `f391c0becc00c84c1e8f203cee8edfabc18d0acfb28e315ada71f76057fb82c5`。未手工复制媒体掩盖、未新编码修它。因此本次转入正文与Word通过，附件继承不完整，不能称全部转入验收通过。
- 现场证据：`delivery/RESULT.json`、`FINAL_PRIVACY_SOURCE_MEDIA.json`、正常source/target GET、transfer响应、两个真实docx及XML抽取；无二次转入。

## 验证、代码与版本
- 本次唯一编码POST只修 `tests/transcribe-saved-recovery.mjs` 的真实契约：合法说明节内canary、无标记前缀仍拒绝、真实mode与Word查询、实际CLI pinned函数依赖；隐私/拒绝例断言保留。已真正走到prepare/save/正常GET/匿名跨owner/双版本Word XML/pin重复拒绝/fetch0，而非正例提前失败冒充覆盖。
- staging和work均 **16套正式测试 + 全树tsc通过**，含parser、privacy、ready/guard/UI/server/backend routes、native34断言/strict native mocks等；无skip。双树完整Next build均在无key环境、内核seccomp强制断网下通过，不以npm_config_offline冒充断网。
- 机械落work3文件：既有模型产出的 `lib/docx.ts`、`scripts/recover-saved-transcribe.mjs`，以及本次修正测试。156源码文件 staging/work/部署一致；`.data`仍未写入work。旧.next备份未删。
- buildID `GWlHrikjChPrVw8d-1NrD`，发布包SHA `327c4cdae11ffcee32deabdc638993206dcd5d78df7cc0c4f9f568f33d26c9cf`。`LANDING.json`/`SOURCE_HASHES.json`/`LANDED_SOURCE.diff`与双树测试、build收据均在本目录。

## 当前候选与浏览器交接
- 服务器目录 `/opt/studio-workbench-3/releases/recovery-20261122-2311`，PID **405856**，startticks **91059452**，仅127.0.0.1:3199。真实cwd/PID核对通过；fixture=false，无业务key/秘密命名env、无.env。
- 同一egress wrapper/BPF实际probe：listen允许，connect/sendto/sendmsg均EPERM；运行进程NoNewPrivs=1、Seccomp=2。旧8000 PID196416、旧3328 PID971658未动。未公开切站、未改nginx/DNS/防火墙。
- 3319隧道已恢复：SSH PID **1513080**，startticks **10897361**，loopback健康200，未读取浏览器cookies。
- 源页面 **http://localhost:3319/breakdown**，在大厅选上述「真实复验…1723」标题；源码该页不支持id深链，不假造深链。
- 源Word **http://localhost:3319/api/upload?id=112087e5-3b44-4e55-872a-2ceb45046c00&export=docx**。
- 已有国外目标 **http://localhost:3319/studio?id=ee47c465-001a-48bb-ba46-ee8b4d217807**。
- 原ayin会话已保留，父会话优先复用原localhost浏览器登录；若失效走正常/login，勿注入HTTP cookiejar、勿重置账号。允许只读打开、查看9场、下载Word、读取既有目标；**不要再次生成/点击重新开始/再次转入或重跑恢复**。
- 浏览器实际界面与下载操作仍待父会话；本agent未操作/派遣浏览器。

## 内容准确性：仅做现有文本对照，未判视频通过
已读不完美参考 `ep01.clean_qc.md`，不修改、不回填、不喂编码模型。九场主要情节顺序吻合，但至少需父会话视听确认：开头「妈妈，老婆」与当前仅「妈妈」；衣字与「下来一定瘦」缺失/歧义；「小朱朱/朱投」称呼、父亲名牌/对白称呼冲突；尾声「啊哈…啊…」当前归朱投，参考归母亲画外。参考仍有两处待人工补写且有可能重复动作，不能作精确金标准。当前正文还保留原返回的 `[cite: 1]` 引用残留，未默删；这是内容质量待核，不是已发现密钥泄漏。**数据/导出契约通过≠视频真实还原准确性通过。**

## 备份与回滚边界
- 旧隔离版本完整保留 `/opt/studio-workbench-3/releases/privacy-20261122-1841`。
- 部署前版本/数据/私存备份 `/opt/studio-workbench-3/backups/pre-recovery-20261122-2311`；apply前版本6备份 `/opt/studio-workbench-3/backups/recovery-data-20261122-2311`。
- **已恢复version7及新转入目标后的私有完整备份** `/opt/studio-workbench-3/backups/post-recovery-20261122-2311/recovered-data-and-private-evidence.tar`，SHA `894ab2bbc36423f2b3108bd0dba76c3259ec0f3d4fb43e8e25987dff1b01821a`。
- 工作源码旧件在 `backup_work_sources/`，旧.next在build收据所列backup路径。若回滚先核现PID/cwd/startticks再停3199，保存当前数据后选已备份版本；**不可直接用version6旧store覆盖本次恢复/新目标**。现成受控启动/停止步骤见 `rollout_candidate.py` 与 `RUN_PINNED_RECOVERY_OPERATOR.py`；这两者包含一次性历史前置，不可盲重跑整脚本。未做自动回滚或声称旧备份恢复演练通过。
- npm公告仍high1/critical1，已沿用可达性审查；WebSocket SSRF确实适用，当前loopback/隧道+内核禁出站仅作隔离缓解，未满足公开发布条件，不切正式入口。

## 调用与费用
- 本轮Claude编码 **1 POST**、无retry/续写/换线/并发；实时核实sonnet5.5。原报input491/output36347、cacheCreate2576/cacheRead12265，明显异常；请求max_tokens2800，实际输出**4763字节/4719字符**，完整end_turn/message_stop。逐笔原值已记录 `/home/box/claude/usage.log` 的 `fixture-contract-recovery-2311`，费用 **unknown**，不估算、不当0。
- 新增业务/视频/视觉/ASR模型调用 **0**；只复用已存真实返回。唯一现场POST是已授权正常国外转入，不是模型生成。
- 操作验证脚本第一次仅因HTTP header字典大小写判断提前停在Word MIME，未发转入；随后依据真实200/MIME改正客户端检查，完整通过。该操作脚本不属于生产/正式测试补丁，未为凑绿改应用断言。

结论：**同一份已存正文现已真正写回为可读的正常项目，双版本Word和一次转入正文已现场验证。** 仍有目标附件0字节、浏览器与内容准确性待验、公开入口安全缓解未完成；不能称第三步完整验收或正式上线，不进4—6。
