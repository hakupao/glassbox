// glassbox 样稿共用的虚构数据。除 contributions.total 取自公开的 GitHub 主页外，数字全部是编的；项目名只用公开仓库或「私有项目」。
// 各样稿用 <script src="sample-data.js"></script> 引入，读 window.GB。
window.GB = {
  generatedAt: "2026-11-17T10:30:00+09:00",
  owner: "hakupao",
  today: {
    requests: 1284, sessions: 23,
    tokens: { input: 3.42e6, output: 0.61e6, cacheRead: 41.8e6, cacheWrite: 2.1e6, reasoning: 0.18e6 },
    cacheHitRate: 0.912,
    costUsdApiEquivalent: 48.7,
    byAgent: [
      { agent: "Claude Code", requests: 1032, tokens: 44.9e6, cost: 41.2 },
      { agent: "Codex", requests: 252, tokens: 3.2e6, cost: 7.5 }
    ],
    byModel: [
      { model: "claude-opus-5-5", requests: 812, cost: 36.9 },
      { model: "claude-sonnet-5-5", requests: 220, cost: 4.3 },
      { model: "gpt-5.4-codex", requests: 252, cost: 7.5 }
    ]
  },
  // 近 30 天每日 API 等价费用（美元），trend30d 是合计，trend30dCodex 是其中 Codex 的部分
  trend30d: [12.1,18.4,9.2,22.7,31.5,28.9,6.3,4.1,19.8,26.2,33.4,41.0,37.6,15.2,8.8,24.5,29.1,35.7,44.2,39.8,12.6,7.4,27.3,32.8,38.1,46.5,51.2,22.9,17.3,48.7],
  trend30dCodex: [1.2,3.8,0.4,2.1,6.9,4.4,0.0,0.3,5.2,3.1,2.4,8.8,9.6,1.0,0.2,1.9,6.3,7.7,4.1,2.8,0.9,0.0,3.6,8.2,10.4,6.0,4.9,1.7,3.3,7.5],
  // 额度：pace 是按「已用 ÷ 已过时间 − 1」算好的值，只给 v1 样稿用；v2 页面自己实时算
  quota: [
    { agent: "Claude Code", window: "7 天", usedPct: 41, resetsAt: "2026-11-20T09:00:00+09:00",
      history: [0,3,6,9,11,14,17,20,22,25,28,31,34,37,41], pace: -0.29 },
    { agent: "Codex", window: "5 小时", usedPct: 55, resetsAt: "2026-11-17T13:10:00+09:00",
      history: [0,6,13,21,30,38,46,55], pace: 0.18 },
    { agent: "Codex", window: "7 天", usedPct: 70, resetsAt: "2026-11-20T00:00:00+09:00",
      history: [0,9,17,26,34,43,52,61,70], pace: 0.10 }
  ],
  // GitHub 贡献：近 53 周 × 7 天，每格当天贡献数（用 seed 生成，见下方）
  contributions: { total: 6832, weeks: 53 },
  activity: [
    { t: "2026-11-17T10:12:00+09:00", repo: "IT-Passport-Learning", public: true, title: "feat: 第 12 章模拟题解析", branch: "main", hash: "a91c3e2" },
    { t: "2026-11-17T09:48:00+09:00", repo: null, public: false, title: "fix: 修正映射规则的空值处理" },
    { t: "2026-11-17T09:05:00+09:00", repo: "sdtm-pedia", public: true, title: "docs: 补全 AE 域变量说明", branch: "main", hash: "4be0d71" },
    { t: "2026-11-16T22:31:00+09:00", repo: null, public: false, title: "refactor: 拆分校验流水线" },
    { t: "2026-11-16T21:02:00+09:00", repo: "shuttle-path", public: true, title: "feat: 步法热区可视化", branch: "dev", hash: "7f20a19" },
    { t: "2026-11-16T17:44:00+09:00", repo: "badminton-coach", public: true, title: "chore: 升级依赖", branch: "main", hash: "c03d55b" },
    { t: "2026-11-16T15:20:00+09:00", repo: null, public: false, title: "test: 增加 ****** 的边界用例" }
  ]
};
// 可复现的伪随机贡献格子：GB.contrib[w][d]
(function(){ let s = 20261117; const r=()=>((s=(s*1103515245+12345)%2147483648)/2147483648);
  window.GB.contrib = Array.from({length:53},(_,w)=>Array.from({length:7},(_,d)=>{
    const base = (d===0||d===6)?0.35:1; const wave = 0.6+0.4*Math.sin(w/6);
    const v = r()*base*wave; return v<0.18?0:Math.round(v*v*42); })); })();
