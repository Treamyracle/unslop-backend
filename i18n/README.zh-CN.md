<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (简体中文)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <b>简体中文</b> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>你的编程智能体 10 分钟写完了接口，但它是不是也顺手塞进了 101 条 SQL 查询和 15 MB 全表扫描？</b><br>
  面向 Claude Code、Codex、Cursor、Google Antigravity 与 Gemini CLI 的测量优先后端性能去冗 Skill。<br>
  每一次优化都必须通过<b>配对基线/修复前后基准对比</b>与<b>严格 Golden SHA-256 等价校验</b>。
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## 核心能力

不同于只修前端 UI 的 `heydamir/unslop`、只做命名与风格检查的 `desloppify`，也不同于将 CPU 函数移植到 Rust 的 `fast-anything`，`unslop-backend` 专注于**可量化的后端数据、SQL/ORM、载荷与异步 I/O 浪费**：
- **N+1 查询雪崩 (`n_plus_one_cascade`)**：循环内逐条查询关联用户与明细
- **缺失或失效索引 (`missing_or_broken_index`)**：全表扫描、非 SARGable 条件、`OFFSET` 深分页悬崖
- **`SELECT *` 载荷膨胀 (`overfetch_and_payload_bloat`)**：读取/返回大字段 JSONB 与审计日志
- **应用层聚合 (`in_app_aggregation`)**：把数千行记录拉进内存过滤、排序、求 Top-K
- **串行异步瀑布 (`async_waterfall`)**、**连接与长事务膨胀**、**内存流缓冲**、**冷启动与 AI/LLM 批量调用优化**

## 六阶段闭环流程

1. **阶段 1 — 侦察与预扫描 ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md))**：运行零依赖静态预扫描器 [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) 生成候选线索，并行 4 个 `research` 智能体构建 `workload-ledger.json`，经 [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) 校验。
2. **阶段 2 — 本地基线与 Golden 快照 ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md))**：使用确定性种子生成 `>= 1,000` 行数据，采集查询数、扫描行数、读取字节、`p50/p95/p99`、堆增量及标准 JSON `golden_sha256`。
3. **阶段 3 — 覆盖驱动狩猎 ([`HUNTING.md`](../skills/unslop-backend/HUNTING.md))**：逐单元检查 8 类后端冗余，并通过覆盖审查与 `--require-complete` 门禁。
4. **阶段 4 — 实证或最小修复**：在独立分支应用最小等价修复并运行 [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs)，一旦出现输出漂移、冷热缓存混测或收益低于噪声阈值立即退出 `1`。
5. **阶段 5 — 独立怀疑者复核**：Fresh Skeptic 检查排序并列键、`NULL`/软删语义、多租户缓存隔离，并通过 [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs) 交叉校验。
6. **阶段 6 — 生成中立报告**：输出 `REPORT.md`、`BENCHMARKS.md`、`FINDINGS-DETAIL.md` 与 `NEEDS-VALIDATION.md`。

## 真实开源案例：`louislam/uptime-kuma` (`94.8k★`) 与本地复现

基于 `node:sqlite` 真实还原 `louislam/uptime-kuma` 上游表结构与 SQL 查询（commit `1cc2fa7`，非缓存命中路径）：`StatusPage.getStatusPageData` 查询数 **`214 → 7 (-96.7%)`**，扫描行数 **`315,554 → 915 (-99.7%)`**，`getRSSPageData` 查询数 **`314 → 8 (-97.5%)`**，耗时测试与统计采样完全解耦，输出保持 **Golden SHA-256 完全一致**（详见 [案例报告](../examples/case-studies/uptime-kuma/README.md)）。

## 快速安装与本地体验

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
```

```bash
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

更多细节请参阅 [英文主文档](../README.md) 与 [验证状态矩阵](../docs/STATUS.md)（[MIT 协议](../LICENSE)）。
