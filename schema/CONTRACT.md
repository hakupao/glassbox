# glassbox 数据契约 v1

两份契约：

1. **探针上报**（`glassbox.probe/1`）：各台电脑 → 部署机 `/ingest`。
2. **页面数据**（`glassbox.page/1`）：部署机 → 网页。私有在线版和公开快照**结构相同**；公开版由导出器按白名单**重新构建**，私有值替换成模糊占位。

示例见 `schema/examples/`，全部是虚构数据，由 `generate.py` 生成并自检。

**冻结范围**：c-v6 已经用到的部分（§2 中没有标注的字段）现在冻结。标注 *provisional* 的块（机器、服务、运行时、tailnet、定时任务、按项目），在 S09 面板定稿之前还可以改。

## 0. 通用约定

- **时间**：ISO 8601，带时区偏移。探针上报一律用 UTC。**切日、切小时只由 hub 按自己配置的时区完成**，探针不切。hub 的时区必须是整点偏移（例如 +09:00），因为用量按 UTC 整点分桶。
- **金额**：美元浮点，字段名以 `Usd` 结尾，是 API 等价估算。
  - **只有**探针的 row 和 page 的 `byModel[]` 允许 `costUsd: null`（该模型完全没有定价）。
  - 其余所有汇总金额只累加已定价的部分，永远不是 `null`；同时附带 `unpricedRequests`，记录有多少请求没算进去。
  - 计价使用的价格表版本写进 `pricingVersion`（例如 `"2026-11-17"`）。价格表更新后，hub 可以要求探针重新上报。
- **Token**：`{input, output, cacheRead, cacheWrite, reasoning}`，全部是整数。
  - `input` 不含缓存部分：Codex 的 `input_tokens` 要先减去 `cached_input_tokens`。
  - `reasoning` 是 `output` 的一部分，不额外计入总量。
  - 总量 = input + output + cacheRead + cacheWrite。
- **Agent**：`"claude-code"` | `"codex"`。
- **模型**：去掉日期后缀的基础 ID。fast 模式记为 `<model>:fast`。探针要把云厂商的 ARN 或推理配置名还原成基础模型名，还原不了就记为 `"other"`。

### 0.1 可隐藏文本 `Text`

所有可能涉及隐私的名称都用 `Text` 类型：项目名、仓库名、机器名、服务名、设备名、任务名、账号。

```jsonc
"repo": "sdtm-pedia"                           // 明文：私有版；或公开版里经白名单允许的值
"repo": {"masked": true}                       // 模糊占位：前端按固定宽度（8 个占位字符）渲染并加模糊
"project": {"masked": true, "group": "private"} // 合并行：前端显示固定文字「私有项目」
```

- 不带长度信息，避免通过长度猜出原文。
- 私有版里不会出现 `masked`。

## 1. 探针上报 `glassbox.probe/1`

`POST /ingest`，请求头带 `Authorization: Bearer <机器 token>`，请求体为 JSON。

```jsonc
{
  "schema": "glassbox.probe/1",
  "machine": "A",                    // 必须与 token 绑定的机器一致，否则返回 400
  "probeVersion": "0.1.0", "pricingVersion": "2026-11-17",
  "sentAt": "…Z", "tz": "Asia/Tokyo", // tz 只作展示

  "usage": {
    "range": {"from": "2026-11-15T00:00:00Z", "to": "2026-11-17T02:00:00Z"},  // 半开区间 [from, to)，UTC 整点
    "rows": [{
      "hourStart": "2026-11-17T01:00:00Z",
      "agent": "claude-code", "model": "claude-opus-5-5", "project": "p_…",
      "requests": 42, "unpricedRequests": 0,
      "tokens": {…}, "costUsd": 1.23
    }],
    "sessions": [{                    // 按会话 ID 在本机去重后计数；会话 ID 本身不上报
      "hourStart": "…Z",              // 会话第一条请求所在的 UTC 小时，会话按这个时间归属
      "agent": "claude-code", "project": "p_…", "count": 3
    }]
  },
  "projects": {                       // 本次 rows / sessions / git 里引用到的所有项目键，都必须在这里出现
    "p_…": {"name": "sdtm-pedia", "remote": "github.com/owner/sdtm-pedia"}
  },
  "quota": [{"account": "a_1f2e3d4c", "agent": "claude-code", "window": "7d",
             "usedPct": 41, "resetsAt": "…", "sampledAt": "…"}],
  "runtimes": [{"agent": "codex", "version": "x.y.z", "processes": 2, "activeSessions": 1}],
  "git": [{                           // 快照：每个项目近 60 天内、作者是本人的提交
    "project": "p_…", "remote": true,  // remote=false 表示仓库没有远端
    "commits": [{"t": "…", "hash": "4be0d71…（完整 40 位）", "branch": "main", "title": "docs: …",
                 "pushed": true}]           // false = 还没推到任何远端；hub 只对这类和无远端项目保留 local 来源
  }],
  "jobs": [{"name": "backup", "lastRun": "…", "lastSuccess": "…", "ok": true}]
}
```

### 1.1 语义

- **usage 是区间快照，不是增量**：`range` 内本机的全部数据都要给出，hub 按 `(machine, range)` 整体替换。探针每次都从本地缓存重新聚合整个区间，日志的增量缓存只用来加速解析。
- **防止被残缺数据覆盖**：转录文件会被清理（Claude Code 默认约 30 天）。
  - hub 按 `(machine, hourStart)` **逐小时**比较：对 2 天以前的小时，新值的请求数比已有值少 5% 以上时，**保留旧值**，并写一条告警。告警会显示在私有版上。
  - 合法的下调（例如修了去重 bug）走显式重设基线：在请求体里加 `usage.rebaseline: true`。只有 `probeVersion` 比该机器上次上报的版本新，或者运行 hub 的手动命令时，才接受重设。
- **会话**：会话只存在于一台机器上，hub 跨机器直接相加即可。
  - 一个会话跨小时、跨模型，也只计一次。
  - 归属时间取"第一条请求"：先按全局 message.id 去重，再取本会话里第一条**不是重放**的请求。resume 和 subagent 会带着原时间戳重放历史请求，那些不算。
  - 跨零点的会话归到第一条请求所在的那一天。
  - 同一个请求出现在多个会话的转录里（fork、resume）时，归属**最早创建的那个转录文件**所在的会话；用量取 output 最大的那份。
- **去重的前提**：每台机器只解析本机产生的转录。`~/.claude` 和 `~/.codex` 如果被同步盘或 dotfiles 同步过，探针要检测出来并告警，同步过来的副本跳过不解析。
- **项目键**：
  1. 取 cwd 所在仓库的根目录（`git rev-parse --show-toplevel`）。cwd 不在任何 git 仓库里时，记为保留键 `p_other`，按私有处理；`projects` 里要有 `"p_other": {"name": "other", "remote": null}`。
  2. 有 `origin` 远端时，先把远端地址归一化成 `host/owner/repo`：去掉协议、凭据、端口和 `.git`，整体转小写（GitHub、Gitea 的路径不区分大小写），ssh 别名按 `.local` 里的映射表还原成真实主机。项目键 = `p_` + sha256(归一化后的远端地址) 的前 12 位。同一个仓库在不同机器上会得到同一个键。
  3. 没有远端时，项目键 = `p_` + sha256(机器 id + 仓库根目录名) 的前 12 位，跨机器不合并。
- **git 提交**：
  - 按 `(machine, project)` 整体替换，rebase 掉的旧哈希会自然消失。
  - 只计 `.local` 里配置的作者邮箱写的提交；邮箱本身不上报。
- **额度**：`account` 是账号标识（邮箱或组织 ID）加盐后 sha256 的前 8 位。hub 按 `(account, agent, window)` 取最新的样本。页面上的 `quota[].account` 用 `.local` 里配置的代号（例如 `"K"`），一个 agent 有多个账号时访客也能区分。没有配置代号的新账号：私有版里显示哈希，公开版里整条丢弃，并在私有版上提示"有未命名账号"。
- **快照过期**：机器离线超过 15 分钟后，它的 `runtimes` 视为过期，页面上标成灰色；`jobs` 保留最后一次的值。
- 各个部分都可以省略。省略表示"这次没有新数据"，不等于清空。

### 1.2 不上报

对话正文、命令行、绝对路径、会话 ID、文件名、作者邮箱、账号原文。

## 2. 页面数据 `glassbox.page/1`

网页读取 `window.GB`。公开快照把它内嵌进 HTML，私有在线版由服务端注入。

```jsonc
{
  "schema": "glassbox.page/1", "view": "private" | "public",
  "generatedAt": "…", "tz": "Asia/Tokyo", "pricingVersion": "2026-11-17",

  "today": {
    "requests": 1284, "sessions": 23, "unpricedRequests": 0,
    "tokens": {…}, "cacheHitRate": 0.887,      // cacheRead / (input + cacheRead + cacheWrite)
    "costUsd": 48.7,
    "byAgent": [{"agent", "requests", "tokens": {…}, "costUsd"}],
    "byModel": [{"model", "agent", "requests", "costUsd"}],
    "byProject": [{"project": Text, "public": bool, "requests", "costUsd"}],   // provisional
    "hourly": [{"hour", "requests", "costUsd"}]                                // provisional；不进公开版
  },

  "trend": [{"date", "costUsd": {"claude-code": 41.2, "codex": 7.5}}],  // 近 30 天，旧→新，最后一项是今天

  "quota": [{
    "account": "K",  /* 代号 */ "agent", "window": "5h" | "7d",
    "usedPct", "resetsAt", "sampledAt",
    "history": [{"t", "usedPct"}]              // 当前窗口内的样本
  }],

  "contributions": {
    "total": 6832,                              // = sum(days[].count)
    "days": [{"date", "count"}]                 // 从 53 周前的那个周日起，到今天为止
  },

  "activity": [{                                // 新→旧，最多 50 条
    "t", "source": "github" | "gitea" | "local",
    "repo": Text, "public": bool, "title",
    "branch", "hash", "url", "machine",         // 私有条目在公开版里这几项都是 null
    "pushed": bool                              // provisional：false = 只在本地，还没推到远端
  }],

  "machines": [{ … }],   // provisional：id、label: Text、role、os、online、lastSeen、probeLastReport、system、history
  "services": [{ … }],   // provisional：一个服务一行（hub 在导出前合并容器与监控，打码后无法再合并）；name: Text、kind（container|monitor|both）、machine、status（up|down|paused|pending|maintenance|unknown）、uptimePct24h、cpuPct、memBytes
  "runtimes": [{ … }],   // provisional：machine、agent、version、processes、activeSessions、stale
  "tailnet":  [{ … }],   // provisional：name: Text、os、online、lastSeen
  "jobs":     [{ … }],   // provisional：name: Text、machine、lastRun、lastSuccess、ok

  "hidden": ["tailnet"]  // 公开版里整块不公开的面板；这些块的值为 []
}
```

### 2.1 hub 的计算规则

- **代码活动按 hash 跨来源去重**，同一个提交只保留一条，来源优先级 github > gitea > local。local 来源只保留 `remote=false` 的项目的提交，以及没有推送到远端的提交。
- `contributions.days[].count` = 当天去重后的提交数。它不是 GitHub 官方的贡献数，所以 S10 要把 c-v6 的标题"GitHub 贡献"改成"提交"一类的说法。GitHub 主页显示的官方总数（含 issue、PR 等）如果要展示，另外放在可选字段 `contributions.githubOfficialTotal`。
- `trend` 的最后一项必须是今天，它的值与 `today` 一致。
- 其余规则（`hub/page.py`）：
  - 切日、切小时按 hub 配置的 `tz`；不是整点偏移就拒绝生成。页面里的时间一律换算成这个时区的偏移。
  - `trend` 每一项都有 `claude-code` 和 `codex` 两个键，没有用量的日子为 0。
  - `quota`：每个 `(account, agent, window)` 取最新样本；`history` 是 `resetsAt - 窗口长度` 之后的样本。代号来自 hub 配置 `[accounts]`，没配的显示哈希，并在 `warnings` 里提示。
  - `services`：容器（Beszel 统计 / Docker 状态）和 Kuma 监控按 `(machine, 名字归一化后相等)` 合并；名字不同的用 hub 配置 `[services.merge]`（监控名 → 容器名）指定。合并行用监控名，状态取两者中更差的。
  - `runtimes[].stale`：该机器探针超过 15 分钟没有上报。`machines[].online`：Beszel 15 分钟内报告在线，或探针 15 分钟内上报过。
  - `machines[].system` 要么字段齐全，要么为 `null`。没有探针的机器，`role` / `os` / `label` 来自 hub 配置 `[machines.<代号>]`。

### 2.2 详情页字段（*provisional*）

只在私有版里出现。没有加进 `public_fields.json`，所以导出器默认丢弃它们。

```jsonc
{
  "usageDays": [{                  // 近 90 天，旧→新，最后一项是今天；没有用量的日子全为 0
    "date", "requests", "sessions", "unpricedRequests", "tokens": {…}, "cacheHitRate", "costUsd",
    "byAgent":   [{"agent", "requests", "sessions", "tokens": {…}, "costUsd"}],
    "byModel":   [{"model", "agent", "requests", "unpricedRequests", "tokens": {…}, "costUsd"}],   // costUsd 规则同 today.byModel
    "byProject": [{"project": Text, "public", "requests", "sessions", "unpricedRequests", "costUsd"}]
  }],
  "code": {
    "repos": [{"repo": Text, "public", "sources": ["github"|"gitea"|"local"], "commits", "unpushed",
               "machines": ["A"], "lastCommit"}],      // 与 contributions 同一时间范围、同一份去重结果；按 lastCommit 新→旧
    "commits": [{ …同 activity[] 的条目 }]              // 近 90 天，新→旧，最多 500 条
  },
  "warnings": [{"t", "machine", "kind", "detail"}]      // 近 7 天的 hub 告警（shrink、rebaseline-refused 等）和未命名账号；t 可为 null
}
```

已有块的扩充（同样是 *provisional*）：
- `machines[].history[]` 增加 `diskPct`。history 覆盖近 24 小时，每 20 分钟一个点（来自 Beszel）。
- `contributions.githubOfficialTotal`：采集过 GitHub 日历后才给出。

## 3. 公开版不变量（导出器构建、闸门检查，任何一条不满足就拒绝发布）

1. **白名单重建**：`schema/public_fields.json` 是一张"字段路径 → 值类型"的表。导出器只复制表里列出的路径，构建出公开版。**新增的字段默认不进公开版**，必须显式加进这张表。闸门遇到表外的 key 就拒绝。
2. **Text 字段**（类型 `text`）：要么是 `{"masked": true…}`，要么它的值在 `.local/public.local.toml` 里**这个字段**的允许名单中。允许名单按字段分开；公开仓库名由 GitHub 可见性自动加入 `repo` 和 `project` 两个字段的名单。
3. **逐值类型校验**：闸门对每条路径上的每个值，按表里声明的类型校验，不符合就拒绝。类型取值：
   - 基本类型：`number`、`bool`、`null`；
   - 时间与版本：`iso`（ISO 时间）、`date`（`YYYY-MM-DD`）、`hash`（`^[0-9a-f]{7,40}$`）、`semver`；
   - 取值受限：`enum:a|b|…`（封闭枚举）、`const:…`（固定值）；`code`（机器或账号代号，`^[A-Z]$`，或 `.local` 里配置的代号）；`model`（价格表里出现过的模型名，或 `"other"`）；
   - 需要特殊处理：`url:public-repo`（必须指向公开仓库）、`title`（走规则 5）、`text`（规则 2）。
   - 类型后面加 `?` 表示也可以是 `null`。
4. **私有条目**（`public: false`）：`branch`、`hash`、`url`、`machine` 一律为 `null`，`t` 截断到整点。
5. **提交标题**：先过正则打码（密钥、邮箱、IP、路径、工单号 `[A-Z][A-Z0-9]+-\d+`）和关键词屏蔽。`.local` 里的 `privateTitles` 开关有两档：`"redacted"`（默认，保留打码后的标题）或 `"prefix-only"`（只保留 `fix:` 这类前缀）。
6. **名单比对**：`.local/redact_terms.local.json` 里的词和所有私有名字，都不得出现在产物的任何位置，包括 HTML、JS 和注释。
   - 归一化后（不分大小写，去掉 `-`、`_`、`.` 和空格）长度至少 5 的词：在同样归一化后的全文里做子串匹配，这样 `FalconLedger`、`falcon_ledger` 都能拦下。
   - 更短的词（如 `app`、`api`）：在原文上按词边界匹配，避免大量误报。
   - `.local` 里可以给单个词指定匹配方式。
7. `hidden` 里列出的块，值为 `[]`。`today.hourly` 不进公开版。
