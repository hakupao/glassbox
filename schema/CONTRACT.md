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
                 "pushed": true,            // false = 还没推到任何远端；远端来源没有同 hash 时，hub 用 local 兜底（§2.1）
                 "nFiles": 3}]              // 可选：这个提交改动的文件数（只有数字，没有文件名）；合并提交为 0
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
  - `nFiles`（S17 R09）：每个仓库只多跑一次 `git log --numstat`，在本机数出每个提交的文件数，只上报数字。这次调用失败或超时时，提交照常上报，只是不带 `nFiles`。旧版探针不发这个字段，hub 照常接收；hub 也忽略提交里它不认识的键，所以 hub 可以先于探针升级。
- **额度**：`account` 是账号标识（邮箱或组织 ID）加盐后 sha256 的前 8 位。hub 按 `(account, agent, window)` 取最新的样本；某个窗口已过重置时间、而同一账号同一 agent 之后还在上报别的窗口时，说明套餐已不再有这个窗口（例如没有 5 小时限制的套餐），页面不再显示它，等它再出现新样本时自动恢复。页面上的 `quota[].account` 用 `.local` 里配置的代号（例如 `"K"`），一个 agent 有多个账号时访客也能区分。没有配置代号的新账号：私有版里显示哈希，公开版里整条丢弃，并在私有版上提示"有未命名账号"。
- **快照过期**：机器离线超过 15 分钟后，它的 `runtimes` 视为过期，页面上标成灰色；`jobs` 保留最后一次的值。
- 各个部分都可以省略。省略表示"这次没有新数据"，不等于清空。

### 1.2 不上报

对话正文、命令行、绝对路径、会话 ID、文件名、作者邮箱、账号原文。

（S17 R09 确认：探针只报文件数 `nFiles`，不报文件名。页面上的文件路径只由 hub 从 GitHub 取，见 §2.1。）

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
    "pushed": bool,                             // provisional：false = 只在本地，还没推到远端
    "author",                                   // 可选（S17 R09）：hub 的 GitHub 登录名；私有版每条都有，公开版只在公开条目上，私有条目为 null
    "nFiles",                                   // 可选：文件数（探针或 GitHub），可为 null；合并提交可为 0
    "files": [{"s": "M" | "A" | "R" | "D", "p"}] // 可选：文件路径，只在去重后来源是 github、仓库当前公开的条目上；最多 50 条，nFiles 是真实总数
  }],

  "machines": [{ … }],   // provisional：id、label: Text、role（可为 null）、os（可为 null）、icon（可为 null）、color（可为 null）、online、lastSeen、probeLastReport、system、history
  "services": [{ … }],   // provisional：一个服务一行（hub 在导出前合并容器与监控，打码后无法再合并）；name: Text、kind（container|monitor|both）、machine（可为 null：没配机器的监控）、status（up|down|paused|pending|maintenance|unknown）、uptimePct24h、cpuPct、memBytes
  "runtimes": [{ … }],   // provisional：machine、agent、version（可为 null）、processes、activeSessions、stale
  "tailnet":  [{ … }],   // provisional：name: Text、os、online、lastSeen（可为 null）
  "jobs":     [{ … }],   // provisional：name: Text、machine、lastRun、lastSuccess、ok

  "hidden": ["tailnet"]  // 公开版里整块不公开的面板；这些块的值为 []
}
```

### 2.1 hub 的计算规则

- **代码活动按 hash 跨来源去重**，同一个提交只保留一条，来源优先级 github > gitea > local。
  - **local 兜底**（2026-11-17 用户决定）：有远端、已经推送、但 GitHub / Gitea 采集里找不到同 hash 的本地提交（私有仓库、非默认分支、没配 token 等），也计入 `activity`、`contributions` 和 `code.commits`，来源记为 `local`。
  - 同一个 hash 只要 github 或 gitea 来源里有，就只保留那一条；`machine` 从同 hash 的 local 行补上。
  - 这取代了原来"local 只保留无远端项目和未推送提交"的规则。
  - **已知偏差**：用 squash 或 rebase 合并时，远端上是一个新 hash，本地分支上的原始提交 hash 在远端找不到，会按 local 兜底再算一次。同一份工作因此被计两次，`contributions` 和 `code.commits` 偏高，偏高的幅度取决于这种合并方式用得多不多。hub 不按标题或时间猜测去重，因为猜错会漏掉真实提交。
- **作者与文件（S17 R09，2026-11-21 用户决定 D8）**：
  - `author` = hub 采集 GitHub 时记下的登录名（kv `github.login`），不来自探针。私有版每条都带。
  - `nFiles` 存在 hub 表 `commit_files`（按 hash），来自探针上报的文件数或 GitHub；路径列表只来自 GitHub；数字取 GitHub 和探针两者中较大的那个，不论谁先到（GitHub 接口第一页最多列 300 个文件，大提交的列表会被截断）。没有 GitHub 列表时，探针报的数字就是 `nFiles`。
  - `files` 只由 hub 从 GitHub 单提交接口 `GET /repos/{nwo}/commits/{sha}`（`files[].filename`、`status`）取，只取 github 来源、当前公开的提交，按 hash 永久缓存（提交不可变）；每次采集最多 200 个，新的先取，遇到限流（429，或 403 且剩余额度为 0 或带 `Retry-After` 的次级限流）就停到下一轮。404 / 422 也记为已取（没有列表），其他错误（含超时、断连、不是 JSON）跳过这个提交，下一轮重试；连续失败 5 次就停到下一轮。
  - GitHub 的 status 映射：`added` → A、`removed` → D、`modified` → M、`renamed` → R、`copied` → A、`changed` → M，其他 → M。每个提交最多保留 50 条路径，`nFiles` 是总数。
  - 私有仓库、Gitea 和 local 提交在两个视图里都只显示文件数。
- `contributions.days[].count` = 当天去重后的提交数。它不是 GitHub 官方的贡献数，所以 S10 要把 c-v6 的标题"GitHub 贡献"改成"提交"一类的说法。GitHub 主页显示的官方总数（含 issue、PR 等）如果要展示，另外放在可选字段 `contributions.githubOfficialTotal`。
- `trend` 的最后一项必须是今天，它的值与 `today` 一致。
- 其余规则（`hub/page.py`）：
  - 切日、切小时按 hub 配置的 `tz`。前后半年内只要有一个偏移不是整点（例如夏令时切成半小时偏移），就拒绝生成。页面里的时间一律换算成这个时区的偏移。
  - `trend` 每一项都有 `claude-code` 和 `codex` 两个键，没有用量的日子为 0。
  - `quota`：每个 `(account, agent, window)` 取最新样本（`resetsAt` 早于该账号该 agent 最新样本的窗口不输出）；`history` 是 `resetsAt - 窗口长度` 之后的样本。代号来自 hub 配置 `[accounts]`，没配的显示哈希，并在 `warnings` 里提示。
  - `services`：容器（Beszel 统计 / Docker 状态）和 Kuma 监控按 `(machine, 名字归一化后相等)` 合并；名字不同的用 hub 配置 `[services.merge]`（监控名 → 容器名）指定。没有配置机器的监控，只有在匹配的容器名在所有机器里唯一时才合并；否则单独成一行，`machine` 为 `null`。合并行用监控名，状态取两者中更差的。
  - `runtimes[].stale`：该机器探针超过 15 分钟没有上报。`machines[].online`：Beszel 15 分钟内报告在线，或探针 15 分钟内上报过。
  - `machines[].system` 要么字段齐全，要么为 `null`。当前值取 Beszel 最近一条 1 分钟记录（15 分钟内且字段齐全）；没有时退回最近一个 20 分钟点。`history` 仍是 20 分钟序列。没有探针的机器，`role` / `os` / `label` 来自 hub 配置 `[machines.<代号>]`。
  - `machines[].icon` / `color` 来自 hub 配置 `[machines.<代号>] icon = "…"`、`color = "…"`，公开版也带（不涉及隐私）。
    - icon ∈ `laptop | desktop | server | vm | nas | mini | cloud | pi`；color ∈ `blue | green | paper | violet | orange | cyan | yellow | red`。
    - 没配置时给默认值：icon 按 role 和 os（dev / work → laptop，非 macOS 的 dev → desktop；deploy：macOS → mini、Linux → vm、其他 → server；gitea：macOS → nas、其他 → server；其余 server）；color 按代号固定取色板里的一个。
    - 配置了但不在名单里：输出 `null`，并在 `warnings` 里写一条 `machine-config`。前端遇到 `null` 按同样的规则画默认图标和颜色。

### 2.2 详情页字段（*provisional*）

只在私有版里出现。没有加进 `public_fields.json`，所以导出器默认丢弃它们。

**例外**（2026-11-27 用户决定）：`usageDays` 的每日合计（`date`、`requests`、`sessions`、`unpricedRequests`、`tokens`、`cacheHitRate`、`costUsd`）以及 `byAgent`、`byModel` 两组明细进公开版，全是数字、agent 和模型名（模型名规则同 `today.byModel`：价格表以外的记为 `"other"`）。`byProject`、`byMachine` 不进公开版，公开版的每一天因此不带任何项目名和机器代号；前端看到某天没有这两个键，就不显示按项目、按机器的分组和面板。`usageDays[].byProject` 里的名字仍然算私有名（§3 规则 6）。

```jsonc
{
  "usageDays": [{                  // 近 90 天，旧→新，最后一项是今天；没有用量的日子全为 0
    "date", "requests", "sessions", "unpricedRequests", "tokens": {…}, "cacheHitRate", "costUsd",
    "byAgent":   [{"agent", "requests", "sessions", "tokens": {…}, "costUsd"}],
    "byModel":   [{"model", "agent", "requests", "unpricedRequests", "tokens": {…}, "costUsd"}],   // costUsd 规则同 today.byModel
    "byProject": [{"project": Text, "public", "requests", "sessions", "unpricedRequests", "costUsd"}],
    "byMachine": [{"machine", "requests", "sessions", "unpricedRequests", "tokens": {…}, "costUsd"}]   // 机器代号；按 costUsd、requests 降序；各项之和等于当天合计
  }],
  "code": {
    "repos": [{"repo": Text,     /* 有远端时按远端归并，没有远端时按名字 */ "public", "sources": ["github"|"gitea"|"local"], "commits", "unpushed",
               "machines": ["A"], "lastCommit"}],      // 与 contributions 同一时间范围、同一份去重结果；按 lastCommit 新→旧
    "commits": [{ …同 activity[] 的条目 }]              // 近 90 天，新→旧，最多 500 条
  },
  "warnings": [{"t", "machine", "kind", "detail"}]      // 近 7 天的 hub 告警（shrink、rebaseline-refused 等）和未命名账号；t 可为 null
}
```

已有块的扩充（同样是 *provisional*）：
- `machines[].history[]` 增加 `diskPct`。history 覆盖近 24 小时，每 20 分钟一个点（来自 Beszel）。
- `machines[].todayByAgent`：`[{"agent", "requests", "unpricedRequests", "costUsd", "sessions"}]`，这台机器今天（按 hub 时区切日）按 agent 的用量，来自 `usage` / `sessions` 表按 machine 汇总；`costUsd` 只累加已定价部分（§0）。今天没有用量的机器为 `[]`。
- `contributions.githubOfficialTotal`：采集过 GitHub 日历后才给出。

## 3. 公开版不变量（导出器构建、闸门检查，任何一条不满足就拒绝发布）

1. **白名单重建**：`schema/public_fields.json` 是一张"字段路径 → 值类型"的表。导出器只复制表里列出的路径，构建出公开版。**新增的字段默认不进公开版**，必须显式加进这张表。闸门遇到表外的 key 就拒绝。
2. **Text 字段**（类型 `text`）：要么是 `{"masked": true…}`，要么它的值在 `.local/public.local.toml` 里**这个字段**的允许名单中。允许名单按字段分开；公开仓库名由 GitHub 可见性自动加入 `repo` 和 `project` 两个字段的名单。
3. **逐值类型校验**：闸门对每条路径上的每个值，按表里声明的类型校验，不符合就拒绝。类型取值：
   - 基本类型：`number`、`bool`、`null`；
   - 时间与版本：`iso`（ISO 时间）、`date`（`YYYY-MM-DD`）、`hash`（`^[0-9a-f]{7,40}$`）、`semver`（`\d+.\d+.\d+`，可带 `-alpha`、`-beta`、`-rc` 和序号，例如 `1.0.0-rc.1`；不接受构建元数据）；
   - 取值受限：`enum:a|b|…`（封闭枚举）、`const:…`（固定值）；`code`（机器或账号代号，`^[A-Z]$`，或 `.local` 里配置的代号）；`model`（价格表里出现过的模型名，或 `"other"`）；
   - 需要特殊处理：`url:public-repo`（必须指向公开仓库）、`title`（走规则 5）、`text`（规则 2）。
   - 提交文件与作者（S17 R09）：`path`（仓库内相对路径：不以 `/` 开头，没有 `.`、`..` 或空白的路径段，没有盘符和反斜杠，没有控制字符和格式字符，最长 300 个字符）；`enum:M|A|R|D`（文件状态）；`author`（只接受 `public.local.toml` 里 `authors` 列出的 GitHub 登录名，不接受自由文本，也不是 `text`，所以不能用占位符）。
   - 类型后面加 `?` 表示也可以是 `null`。
4. **私有条目**（`public: false`）：`branch`、`hash`、`url`、`machine`、`author` 一律为 `null`，`t` 截断到整点。
   - **文件路径**（S17 R09）：`files` 非空 ⇒ 条目 `public: true`、`pushed: true` 且 `source == "github"`。只有 `pushed` 不够：它的意思是"推到了某个远端"，可能是私有的 Gitea。`files` 最多 50 条，`nFiles` 必须是不小于列表长度的整数；`nFiles` 在任何条目上都只能是非负整数或 `null`。闸门独立检查这几条。
   - **导出器按提交降级**：一个提交里只要有一条路径不是干净的 `path`、含字母、数字、空格和 `. _ - / + @ , ( ) [ ] # ! $` 以外的字符（例如 `%`、`&`、反斜杠、引号、反引号、`<`、`>`、`:`、`~`、`=`，它们可能被闸门解码或认成网址、路径）、命中私有名 / 屏蔽词 / 私有分支片段 / 私有提交 hash、或者含有闸门在所有值里都查的内容（邮箱、IPv4、tailnet / 局域网主机名、密钥、家目录等知名目录；工单号、带点的目录名这类只在标题里查的不算），这个提交就去掉 `files`、只保留 `nFiles`。闸门把整份快照序列化后当成一条字符流来查，所以导出器拼好公开页后还要用同样的方式再查一遍：路径和前后的键、下一个文件连起来拼出私有名时（例如 `"p"` 加上 `ixel-forge/…`），只去掉造成命中的那些提交的列表。路径永远不会让整份快照被闸门拒绝。这一遍同时查页面 JSON 和打包进 index.html 的形式（`<` 写成 `\u003c`，U+2028 / U+2029 也转义），两种都查全部私有名。去掉了多少链接、文件列表、标题和作者，导出器只报数字（导出上下文的 `degraded` 和标准错误输出），不报名字，配置有问题时能看出来。
   - **作者**：导出器只在公开条目上、值在 `authors` 里、且不命中任何私有词时保留 `author`，否则为 `null`。公开提交链接里含私有词（例如登录名是没列出的私有分支片段）时，链接也去掉。
5. **提交标题**：先过正则打码（密钥、邮箱、IP、路径、工单号 `[A-Z][A-Z0-9]+-\d+`）和关键词屏蔽。`.local` 里的 `privateTitles` 开关有两档：`"prefix-only"`（默认，私有提交只保留 `fix:` 这类前缀；2026-11-17 用户决定）或 `"redacted"`（需显式配置，保留打码后的标题）。默认配置下，闸门也检查私有提交标题只剩前缀。
6. **名单比对**：`.local/redact_terms.local.json` 里的词和所有私有名字，都不得出现在产物的任何位置，包括 HTML、JS 和注释。
   - **归一化**：先做 NFKC，删掉格式字符（零宽空格、软连字符等），把西里尔 / 希腊同形字母换成拉丁字母，不分大小写，再去掉所有不是字母或数字的字符。
   - 归一化后长度至少 5 的词，以及含非拉丁文字的词：在同样归一化后的全文里做子串匹配，这样 `FalconLedger`、`falcon_ledger`、`ｆａｌｃｏｎ-ledger`、`falcon/ledger` 都能拦下。
   - 更短的词（如 `app`、`api`）：按整词匹配，避免大量误报。分词时 `_` 也算边界，camelCase、字母与数字、拉丁与其他文字之间也切开，所以 `owl_sync`、`OwlSync` 都能命中 `owl`，`bowling` 不会（2026-11-17 主控决定）。
   - 闸门还会把 HTML 实体、`\uXXXX`、`\u{…}`、`\xHH`、CSS 转义、`%` 编码和 JS 字符串拼接反复解码到不再变化，对每一层都再查一遍。
   - 导出器：标题里只要命中私有名字，整条标题只保留前缀（先解码 `%` 和 HTML 实体再匹配）。导出器还按闸门的全部解码层（HTML 实体、`\uXXXX`、`\u{…}`、`\xHH`、CSS 转义、`\/`、`%` 编码、JS 字符串拼接，反复解码、每一层都查）检查标题和公开分支：任一层命中私有名，或标题解码后出现闸门查的模式（邮箱、IP、网址等），标题只保留前缀，分支打码；发布的仍是原文，只解 `%` 和 HTML 实体（backlog A6）。
   - 导出器：标题本身不含私有名、但和前后的 JSON 连起来才拼出私有名时（例如 `docs: note` 加上下一个键 `branch`），或者只在 index.html 的转义形式里拼出（`<b12` 在那里是 `u003cb12`），或者解码后才和前后连起来拼出（`docs: note` 加上 `branch`），只有造成命中的那条标题保留前缀，其他标题不动；前缀本身仍拼出私有名时（例如 `perf:` 加上 `branch`），整条标题写成 `******`（私有提交只剩前缀的标题也一样）；数量记在 `degraded.titlesJoined`（backlog A5、A6）。
   - 导出器：公开提交的分支和前后的 JSON 连起来拼出私有名时（例如 `feat/wild` 加上下一个键 `hash`），只把那个提交的 `branch` 置为 `null`，其他提交不动；数量记在 `degraded.branchesJoined`（backlog A6）。
   - 导出器：闸门在整份快照（页面 JSON，按 `--out` 写出的缩进形式和 index.html 里的紧凑转义形式，以及连起来的键和值，每个解码层）里查的模式（邮箱、IP、家目录 / 盘符 / `\\主机\` 路径、tailnet 主机、密钥、外部网址、协议相对地址），导出器自己也有一份（照抄闸门，不共用代码），按提交逐条查标题和分支。一个提交的标题或分支序列化后才形成这类模式时（例如标题里的 `\r\n` 在 JSON 里写成 `\\r\\n`，闸门读成 `\\主机\` 路径；标题里的 `"//host` 读成协议相对地址），按上面同样的方式降级：标题先保留前缀、仍命中就写成 `******`，分支置为 `null`；数量也记在 `degraded.titlesJoined` / `degraded.branchesJoined`（backlog A8）。
   - `.local` 里可以给单个词指定匹配方式。
   - **分支片段的豁免**（R10，2026-11-19 用户决定 D4）：私有分支名里有辨识度的片段算私有名，只有两种例外：片段（不分大小写）就是某个公开仓库名（b7e5216，保留：去掉它，配置里没列登录名时 11-19 的停发会重现）；或者它列在 `public.local.toml` 的 `branchFragments` 里。每一项按分支名同样的 `- / _` 拆开，各部分都豁免，例如列出 `IT-Passport-Learning` 就豁免 `Passport`、`Learning`。列出的词如果同时是私有仓库名、屏蔽词等，仍然是私有名：豁免只针对分支片段。拆出来的部分如果是某个私有名、屏蔽词、关键词或 `privateProjects` 的组成词，也不豁免：列出 `Falcon-Tools` 只豁免 `tools`，私有仓库 `falcon-ledger` 的 `falcon` 仍是私有名。导出器和闸门规则相同。
   - **页面代码的本地检查**（backlog A7）：`web/` 里的代码也在全文里，长词按子串匹配，所以改 `web/`（例如背景画库）可能碰巧拼出私有名，闸门随后拒绝每一次发布。`scripts/check_web_terms.py` 直接调用闸门的匹配器（不另写一套，也不和导出器共用代码），用真实词表、真实配置和缓存的私有页（`.local/gate/page.private.json`，`--refresh` 从 hub 取）按 bundle 的方式把 index.html 和它内联的 `web/` 文件拼成整页来查（标签名和文件首尾连起来、两个文件连起来拼出的词也查得到），规则与闸门相同：强词查整页，弱词只查逐字内联代码以外的部分。数据脚本用占位代替，所以和真实数据连起来才拼出的词查不到；也只查私有名，不查闸门的其他模式。只输出 `web/<文件>:<行> term #<序号>`，只在整页里出现的命中报成 `web/index.html:?`。暂存区含 `web/` 时 pre-commit 钩子会运行它（[`install-probe.md`](../docs/runbooks/install-probe.md) 第 1 步）。
   - **私有名的来源**：私有页里所有 Text 字段的值都算私有名（项目、仓库、机器、服务、tailnet 设备、任务的名字，包括 §2.2 的 `code.repos[].repo`、`code.commits[].repo`、`usageDays[].byProject[].project`），除非它被判定为公开或在允许名单里；另外还有私有提交的 hash、链接主机名和分支名里有辨识度的片段。`warnings` 这类自由文本不做启发式提取：自由文本里的主机名等信息靠 `redact_terms` 词表拦截（2026-11-17 主控裁定）。
7. `hidden` 里列出的块，值为 `[]`。`today.hourly` 不进公开版。
