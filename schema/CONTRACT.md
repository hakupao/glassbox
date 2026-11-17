# glassbox 数据契约 v1

两份契约：

1. **探针上报**（`glassbox.probe/1`）：各台电脑 → 部署机的 `/ingest`。
2. **页面数据**（`glassbox.page/1`）：部署机 → 网页。私有在线版和公开快照**结构完全相同**，只有取值不同（公开版的私有字段被替换成模糊占位）。

示例在 `schema/examples/`，全部是虚构数据。

## 0. 通用约定

- **时间**：ISO 8601，带时区偏移，例如 `2026-11-17T10:30:00+09:00`。日期写成 `YYYY-MM-DD`，按部署机配置的时区切日。
- **金额**：美元，浮点，字段名以 `Usd` 结尾。只是 API 等价估算。查不到价格时为 `null`，并计入 `unpricedRequests`。
- **Token**：对象 `{input, output, cacheRead, cacheWrite, reasoning}`，都是整数。
  - `input` 不含缓存部分。Codex 原始的 `input_tokens` 要先减掉 `cached_input_tokens`。
  - `reasoning` 包含在 `output` 里，不重复计入总量。
  - 总量 = input + output + cacheRead + cacheWrite。
- **Agent**：`"claude-code"` | `"codex"`。
- **模型**：日志里的原始 ID，去掉日期后缀。fast 模式记为 `<model>:fast`。

### 0.1 可隐藏文本 `Text`

可能涉及隐私的字符串字段（项目名、仓库名、机器名、服务名、设备名、任务名），类型都是 `Text`：

```jsonc
"repo": "sdtm-pedia"                    // 明文：私有版，或公开版里允许公开的值
"repo": {"masked": true, "len": 11}     // 模糊占位：公开版里的私有值
```

- 前端遇到 `{"masked": true}` 时，渲染成 `len` 个占位字符再加模糊样式。真实文本从不进入公开产物。
- `len` 取真实长度，并钳在 4 到 16 之间，避免从长度推出原文。
- 私有版里不会出现 `masked`。

## 1. 探针上报 `glassbox.probe/1`

`POST /ingest`，请求头 `Authorization: Bearer <机器 token>`，请求体是 JSON。

```jsonc
{
  "schema": "glassbox.probe/1",
  "machine": "A",                 // 机器代号，和 token 绑定；hub 以 token 为准
  "probeVersion": "0.1.0",
  "sentAt": "…",
  "tz": "Asia/Tokyo",

  "usage": {                      // 按 (day, hour, agent, model, project) 聚合
    "days": ["2026-11-16", "2026-11-17"],   // 本次覆盖的日期；hub 按 (machine, day) 整体替换
    "rows": [{
      "day": "2026-11-17", "hour": 10,
      "agent": "claude-code", "model": "claude-opus-5-5",
      "project": "p_3f9a…",       // 项目键，见 projects
      "requests": 42, "sessions": 3,
      "tokens": {…}, "costUsd": 1.23
    }]
  },
  "projects": {                   // 项目键 → 身份；只给 hub 判断可见性用
    "p_3f9a…": {"name": "sdtm-pedia", "remote": "github.com/owner/sdtm-pedia"}
  },
  "quota": [{                     // 额度样本（最新几条即可，hub 按窗口取最新）
    "agent": "claude-code", "window": "7d", "usedPct": 41,
    "resetsAt": "…", "sampledAt": "…"
  }],
  "runtimes": [{"agent": "codex", "version": "x.y.z", "processes": 2, "activeSessions": 1}],
  "git": [{                       // 本机仓库的提交（只扫描配置里的项目根目录）
    "project": "p_3f9a…", "branch": "main",
    "commits": [{"t": "…", "hash": "4be0d71", "title": "docs: …"}]
  }],
  "jobs": [{"name": "backup", "lastRun": "…", "lastSuccess": "…", "ok": true}]
}
```

- **不上报**：对话正文、命令行、绝对路径、会话 ID、文件名。
- **项目键**是 `p_` 加上 hash(remote 或仓库根目录名) 的前 12 位，保证各台电脑上同一个仓库得到同一个键。
- `remote` 统一写成 `host/owner/repo`，去掉协议、凭据和 `.git`。没有远端时为 `null`，hub 一律按私有处理。
- 各部分都可以省略，省略表示"这次没有新数据"，不表示清空。

## 2. 页面数据 `glassbox.page/1`

网页读 `window.GB`。公开快照把它内嵌进 HTML；私有在线版由服务端注入。

```jsonc
{
  "schema": "glassbox.page/1",
  "view": "private" | "public",
  "generatedAt": "…", "tz": "Asia/Tokyo",

  "today": {
    "requests": 1284, "sessions": 23, "unpricedRequests": 0,
    "tokens": {…}, "cacheHitRate": 0.912,       // cacheRead / (input + cacheRead + cacheWrite)
    "costUsd": 48.7,
    "byAgent":   [{"agent", "requests", "tokens": {…}, "costUsd"}],
    "byModel":   [{"model", "agent", "requests", "costUsd"}],
    "byProject": [{"project": Text, "public": bool, "requests", "costUsd"}],  // 公开版里的私有项目合并成一行，project 为 masked
    "hourly":    [{"hour": 0, "requests", "costUsd"}]                         // 24 项
  },

  "trend": [{"date", "costUsd": {"claude-code": 41.2, "codex": 7.5}, "requests", "tokens": {…}}],  // 近 30 天，旧 → 新

  "quota": [{
    "agent", "window": "5h" | "7d", "usedPct", "resetsAt", "sampledAt",
    "history": [{"t", "usedPct"}]               // 当前窗口内的样本，画燃尽图用
  }],

  "contributions": {
    "total": 6832,
    "days": [{"date", "count", "github": n, "gitea": n, "local": n}]       // 近 53 周
  },

  "activity": [{                                // 新 → 旧，最多 50 条
    "t", "source": "github" | "gitea" | "local",
    "repo": Text, "public": bool, "title": "…（已正则打码）",
    "branch": "main" | null, "hash": "4be0d71" | null, "url": "…" | null,  // 私有条目在公开版里都为 null
    "machine": "A" | null
  }],

  "machines": [{
    "id": "A", "label": Text, "role": "dev" | "deploy" | "work" | "gitea",
    "os": "macos" | "linux" | "windows",
    "online": true, "lastSeen": "…", "probeLastReport": "…" | null,
    "system": {"cpuPct", "memUsed", "memTotal", "diskUsed", "diskTotal", "uptimeSec"} | null,
    "history": [{"t", "cpuPct", "memPct"}]       // 近 24 小时，每小时一点
  }],

  "services": [{
    "name": Text, "kind": "container" | "monitor", "machine": "A",
    "status": "up" | "down" | "paused" | "unknown",
    "uptimePct24h": 99.9 | null, "cpuPct": 1.2 | null, "memBytes": 123 | null
  }],

  "runtimes": [{"machine", "agent", "version", "processes", "activeSessions"}],

  "tailnet": [{"name": Text, "os", "online", "lastSeen"}],

  "jobs": [{"name": Text, "machine", "lastRun", "lastSuccess", "ok"}],

  "hidden": ["tailnet"]                          // 公开版里整块不公开的面板，前端显示"请看在线版"
}
```

## 3. 不变量（导出器和闸门都要检查）

1. `view = "public"` 时，`.local/redact_terms.local.json` 里的任何词、任何私有项目或仓库的真实名字，都不能以任何形式出现在产物里（包括 HTML、JS、注释）。
2. 公开版里 `public: false` 的条目，`branch`、`hash`、`url` 全部为 `null`。
3. 公开版里 `machines[].label` 必须是 masked，或者是 `.local/public.local.toml` 里配置的代号。
4. 字段只增不改：新增字段向后兼容。改动含义时升 `schema` 版本号。
