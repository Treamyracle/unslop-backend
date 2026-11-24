<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (한국어)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <b>한국어</b> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>코딩 에이전트가 10분 만에 만든 API, 요청당 SQL 101번과 15MB 풀 스캔이 숨어 있지는 않나요?</b><br>
  Claude Code, Codex, Cursor, Google Antigravity, Gemini CLI를 위한 측정 중심 6단계 백엔드 성능/데이터 슬롭 제거 스킬.<br>
  모든 수정은 <b>사전·사후 벤치마크 지표</b>와 <b>정확한 Golden SHA-256 동등성</b> 게이트를 통과해야 합니다.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## 핵심 탐지 및 제거 대상 (8대 슬롭 클래스)
- **N+1 쿼리 캐스케이드 (`n_plus_one_cascade`)** 및 **누락/비효율 인덱스 (`missing_or_broken_index`)**
- **`SELECT *` 과다 조회 (`overfetch_and_payload_bloat`)** 및 **인앱 집계 (`in_app_aggregation`)**
- **순차 `await` 워터폴 (`async_waterfall`)**, **커넥션/트랜잭션 비대화**, **메모리·스트림 버퍼링**, **콜드 스타트 블로트**

## 6단계 검증 파이프라인
1. [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) 정적 사전 스캔 후 [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs)로 대상 표면 검증 ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. `>= 1,000`건 시드 데이터로 쿼리 수, 스캔 행 수, p95, `golden_sha256` 기준선 측정 ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. [`HUNTING.md`](../skills/unslop-backend/HUNTING.md) 기반 전수 점검 및 `--require-complete` 게이트.
4. 동작 보존 최소 수정 후 [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs)로 Golden SHA-256 일치 및 노이즈 하한선 검증.
5. 독립 검증자가 정렬/NULL/테넌트 캐시 격리를 검증하고 [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs) 실행.
6. `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` 생성.

## 실제 오픈소스 사례: `louislam/uptime-kuma` (`94.8k★`)

`node:sqlite`에서 업스트림 스키마와 쿼리(`1cc2fa7`)를 재현하여 `getStatusPageData` **`214 → 7 (-96.7%)`**, `getRSSPageData` **`314 → 8 (-97.5%)`** 쿼리 절감 및 **Golden SHA-256 완벽 일치**를 검증했습니다([사례 보고서](../examples/case-studies/uptime-kuma/README.md)).

## 설치 및 테스트

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

자세한 내용은 [영문 README](../README.md) 및 [검증 현황](../docs/STATUS.md)([MIT 라이선스](../LICENSE))을 참고하세요.
