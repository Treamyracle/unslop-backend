<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (日本語)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <b>日本語</b> ·
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
  <b>コーディングエージェントが10分で実装したAPI。1リクエストあたり101回のSQLと15MBの全表スキャンが隠れていませんか？</b><br>
  Claude Code・Codex・Cursor・Google Antigravity・Gemini CLI 向けの計測ファーストなバックエンド最適化スキル。<br>
  すべての修正は<b>前後ベンチマーク計測</b>と<b>Golden SHA-256 の完全一致</b>でゲート検証されます。
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## 主な対象（8つのバックエンド・スロップ分類）
- **N+1 カスケード (`n_plus_one_cascade`)**・**欠落/無効インデックス (`missing_or_broken_index`)**
- **`SELECT *` 過剰取得 (`overfetch_and_payload_bloat`)**・**アプリ層集計 (`in_app_aggregation`)**
- **逐次 `await` ウォーターフォール (`async_waterfall`)**・**コネクション/トランザクション肥大**・**ストリーム/メモリ浪費**・**コールドスタート遅延**

## 6フェーズ・クローズドループ
1. [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) で候補を抽出し、[`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md) と [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) で台帳を検証。
2. [`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md) に従い `>= 1,000` 行のローカルデータでベースラインと `golden_sha256` を記録。
3. [`HUNTING.md`](../skills/unslop-backend/HUNTING.md) で全ユニットを調査し、`--require-complete` で漏れを遮断。
4. 最小限の等価修正後に [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs) で `cache_mode` 一致・ノイズ閾値超過・SHA-256 一致を強制。
5. 独立検証者が境界条件やテナント分離を検証し、[`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs) でクロスチェック。
6. `REPORT.md`・`BENCHMARKS.md`・`FINDINGS-DETAIL.md`・`NEEDS-VALIDATION.md` を生成。

## 実在OSSケーススタディ：`louislam/uptime-kuma` (`94.8k★`)

`node:sqlite` 上で上流スキーマとSQL（`1cc2fa7`）を忠実に再現し、`getStatusPageData` を **`214 → 7 (-96.7%)`**、`getRSSPageData` を **`314 → 8 (-97.5%)`** クエリへ削減しつつ **Golden SHA-256 完全一致** を達成しています（[詳細レポート](../examples/case-studies/uptime-kuma/README.md)）。

## インストールと動作確認

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

詳細は [英語README](../README.md) と [検証ステータス](../docs/STATUS.md)（[MIT ライセンス](../LICENSE)）をご覧ください。
