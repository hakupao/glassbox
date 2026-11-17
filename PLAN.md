# glassbox — Plan

> TL;DR：一个"AI 开发驾驶舱"，思路参考 [iamcheyan/svc-dashboard](https://github.com/iamcheyan/svc-dashboard)（清单见 `docs/reference/svc-dashboard-inventory.md`），按自己的环境重写，不 fork。
> 采集 Claude Code / Codex 用量和额度、代码活动、机器与服务状态。同一份数据出两个视图：**私有在线版**只在 tailnet 内访问，**公开快照**脱敏后发布到 GitHub Pages。
> 与参考站唯一的本质区别：数据来自**多台电脑**，由各机的探针推送给部署机汇总。
> 主要风险：隐私数据漏进公开产物或 git 历史。对策是代码与数据分离、导出时脱敏、发布前闸门、gh-pages 单提交强推。

状态：前期讨论已闭合（2026-11-17），进入实施。环境细节（机器名、网络、部署约束）只记在 `.local/`，不进本仓库。

## 1. 范围

| 类别 | 数据 | 来源 |
|---|---|---|
| AI 用量 | 按请求的 Token、模型、API 等价费用，聚合到天 / 小时 / 项目 / 模型 | 各机探针读 Claude Code、Codex 的本地日志 |
| AI 额度 | Claude（7 天 / 5 小时）、Codex（5 小时 / 周）用量百分比与重置时间 | Claude：statusline stdin 的 `rate_limits` 采样（`scripts/statusline-tap.sh`）；Codex：日志里的 `rate_limits` |
| Agent 运行时 | CLI 版本、运行中的进程、活跃会话数 | 各机探针 |
| 代码活动 | GitHub 贡献热力图与提交、Gitea 提交、无远端的本地仓库提交 | GitHub API、Gitea API、探针扫描 git log |
| 机器与服务 | 各机 CPU / 内存 / 磁盘 / 在线时长；容器状态；服务在线情况；tailnet 设备在线情况 | Beszel、Uptime Kuma、只读 Docker API、`tailscale status` |
| 运维任务 | 备份等定时任务最后成功时间 | 日志或状态文件 |

不做：首字延迟（参考站来自它自己的网关，我们不装网关）、写操作类管理功能。

## 2. 架构

```
各台电脑                              部署机（Docker）
┌──────────────┐  HTTPS via tailnet  ┌─────────────────────────────────────┐
│ probe（Python）│ ───────────────────► │ glassbox：/ingest → sqlite            │
│ 只出聚合数字    │   每机一个 token     │   汇总器：GitHub / Gitea / Beszel /     │
└──────────────┘                      │          Kuma / Docker / tailscale     │
                                      │   私有在线版 ◄── tailscale serve（仅 tailnet）│
                                      │   导出器 → 脱敏 → 闸门 → gh-pages 强推   │
                                      │ tailscale sidecar · docker-socket-proxy │
                                      └─────────────────────────────────────┘
                                                          │
                                       GitHub Pages + 自有域名（公开快照，任何人可看）
```

- **探针**：Python 3.12 标准库，在各台电脑上定时运行。只上报聚合数字，不含对话正文、命令行和绝对路径。
- **部署机**：docker compose 里起三个容器。`glassbox` 本体；`tailscale` sidecar，glassbox 共用它的网络，只有出站连接，宿主机不开端口；`docker-socket-proxy` 只放行列出容器。
- **私有在线版**：只在 tailnet 内访问，自己的设备只要登录 Tailscale，在外面也能看；不在公网暴露。
- **公开快照**：参考站的做法——数据内嵌进 HTML，内容没变就不推，gh-pages 每次强推一个单提交（历史里不留旧数据）。
- **前端**：无框架静态页，私有版和公开版共用同一个页面，只换数据。视觉定稿 `design/mockups/c-v6.html`（底色 slate），设计约束见 `design/ASCII_STYLE_NOTES.md`。

## 3. 隐私规则

**仓库**：一个公开仓库，`main` 只放代码和不含隐私的文档，`gh-pages` 放脱敏快照。真实数据只存在于各台电脑和部署机上，永远不进 git。本机信息只放 `.local/`（gitignored）。

**公开快照默认拒绝**：

| | 公开仓库 | 私有仓库 / 自建 Gitea / 无远端 / 查不到可见性 |
|---|---|---|
| 项目名 | 显示 | 模糊块 |
| 提交标题 | 显示（正则打码 + 关键词屏蔽） | 显示（正则打码 + 关键词屏蔽） |
| 哈希 / 分支 / 作者 / 文件 / Diff 链接 | 显示 | 不显示 |
| 用量、会话统计 | 按项目显示 | 合并进「私有项目」 |
| 机器名 | 一律用代号 | — |

- 可见性按 GitHub API 自动判断，仓库改为公开后自动露出。
- **模糊块**：导出时就把真实文本替换成等长占位，再加模糊样式。真实文本绝不进入公开产物（CSS blur 可以在开发者工具里去掉，不能当隐私边界）。
- **个人偏好**由 `.local/public.local.toml` 控制：整块不公开 / 字段模糊 / 关键词屏蔽 / 项目黑名单。
- **三道检查**：导出时逐字段脱敏；发布前闸门（把 `.local` 里的真实私有名单逐字比对，加路径、IP、邮箱、密钥正则，命中即拒绝推送）；`main` 分支的 CI 密钥扫描。
- 会话内容（对话正文、命令行、cwd）一律不出公开快照。私有在线版不打码。

## 4. 日志解析规则（实测确认）

- **Claude**：
  - 同一个 message.id 会在同一个文件里重复多行，也会跨文件重复（resume 和 subagent 的转录会重放历史）。实测 3 天样本中，17589 行只对应 5907 个请求。
  - **必须全局去重**，并保留 output_tokens 最大的那条，因为流式中途的快照里输出数还没写完。
  - `usage.iterations` 里只有 `type=message` 的轮次计入顶层用量；`advisor_message` 轮按它自己的 `model` 单独计。
  - fast 模式记为 `<model>:fast`。
- **Codex**：
  - 逐响应用量取 `token_usage_record`，按 `response_id` 去重；也可以累加 `last_token_usage`。
  - **绝不能**把 `total_token_usage` 相加，那是累计值。
  - `input_tokens` 已包含 `cached_input_tokens`。模型名在 `turn_context.payload.model` 里。
- **时间**：日志时间戳是 UTC，按本地时区切日。
- **规模**：上万个文件、十几 GB。从第一天起就按 (path, mtime, size) 做增量缓存。
- **额度**：不同会话同一时刻报的值可能不同，闲置会话的值会滞后，所以按窗口取最新的样本。额度是账号级的，取所有机器里最新的一条。
- **价格**：见 `docs/reference/pricing-2026-11-17.md`。查不到价格的模型记为 unknown，不估算。

## 5. 实施计划

**Tier 3**：步骤超过 15 个、要跨天，涉及公开仓库，泄露不可逆。trace、审阅记录、核对证据会含真实数据，统一放 `.local/evidence/`。

| Step | 任务 | 验收 | Checkpoint |
|---|---|---|---|
| S01 | git init；隐私扫描脚本（私有名单从 `.local` 读）；全树扫描；首个提交；GitHub 仓库先设为**私有**，S15 再公开 | 扫描零命中；`.local/` 未被跟踪 | 完成 |
| S02 | 冻结数据契约 `schema/CONTRACT.md`：探针上报 + 页面数据 + 模糊占位约定 | 示例生成并通过公开不变量自检；c-v6 所需字段全覆盖（页面适配在 S10） | soft |
| S03 | 探针·AI 用量：解析（按 §4）、增量缓存、聚合 | 与 ccusage 或 jq 独立核对 N=10 个会话：Token 误差 0，费用误差 < 1% | soft |
| S04 | 探针·额度 | 与 statusline 显示值一致 | none |
| S05 | 探针·本地 git 活动 + Agent 运行时 | 与 `git log` 抽查一致 | none |
| S06 | 收件接口 `/ingest`（每机一个 token） | 本机能推；token 错误时拒绝 | soft |
| S07 | 汇总器·GitHub + Gitea | 与网页上的数字一致 | none |
| S08 | 汇总器·Beszel + Kuma + Docker + tailscale | 与各自面板一致 | none |
| S09 | 新面板设计：c-v7 → c-v8（语义色、徽章）→ c-v9（分组疏密、机器一台一行、动效） | 用户认可 | 完成 |
| S10a | hub 生成 page/1：从 sqlite 汇总（切日、合并服务、按 hash 去重提交），私有视图由 hub 提供 | 本机真实数据渲染 c-v9 概览无报错，数字与探针 daily 一致 | soft |
| S10b | 前端正式化 `web/`：5 个页面（概览 / 用量 / 代码 / 机器 / 服务），hash 路由，面板"查看全部"、列表行展开 | 每页截图给用户看 | **hard**（逐页） |
| S10c | i18n：中文 / 日本語 / English，默认跟随浏览器，可切换，`?lang=`；数据原文不翻译 | 三种语言下每页无缺失文案 | soft |
| S11 | 导出器：脱敏 + 模糊占位 | 公开产物不含任何真实私有字符串 | soft |
| S12 | 发布闸门 + 红队样本（含：公开产物不得引用外部字体 / CDN） | 红队样本 100% 拦截 | soft |
| S13 | 部署机部署（compose + Tailscale sidecar，不开宿主机端口） | tailnet 内可访问，局域网和公网不可访问 | **hard** |
| S14 | 其他电脑装探针（按 runbook） | 汇总器收到数据 | **hard** |
| S15 | 公开发布：gh-pages + 自有域名 | 闸门通过；人工逐块检查 | **hard**：首次推送和改 DNS 前问 |
| S16 | Retro | `RETROSPECTIVE.md` 三段齐全 | none |

并行：S03–S05、S07–S08、S09 互相独立。S10 依赖 S02、S09；S11–S12 依赖 S10。

## 6. 决定记录

- 2026-11-17：视觉定为 c-v6（信息优先，今日画作作为底部渐隐背景），底色 slate。
- 2026-11-17：用量自己写简单探针，参考已有的多机采集器的解析规则，不直接用它当数据源。
- 2026-11-17：不分 v1 / v2，§1 全部做。探针用 Python。
- 2026-11-17：部署在部署机的 Docker 里，私有版只在 tailnet 内；外网只看公开快照。
- 2026-11-17：环境细节从本文件拆到 `.local/`。
- 2026-11-17：视觉定为 c-v9（分组疏密、语义色、徽章、机器一台一行、克制动效），底色更暗、面板半透明。
- 2026-11-17：参照参考站做 5 个页面（概览 / 用量 / 代码 / 机器 / 服务），面板可"查看全部"、行可展开；界面支持中文、日本語、English。其余 4 页直接用真实数据做，逐页给用户确认。
