<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (Português)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <b>Português</b> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Seu agente entregou o endpoint em 10 minutos. Ele também entregou 101 consultas SQL e um scan de 15 MB por requisição?</b><br>
  Skill orientada a medição em 6 fases para Claude Code, Codex, Cursor, Google Antigravity e Gemini CLI.<br>
  Cada correção exige <b>telemetria pareada antes/depois</b> e <b>paridade exata Golden SHA-256</b>.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## Principais alvos (8 classes de slop)
- **Cascatas N+1 (`n_plus_one_cascade`)** e **índices ausentes ou quebrados (`missing_or_broken_index`)**
- **Excesso em `SELECT *` (`overfetch_and_payload_bloat`)** e **agregação na aplicação (`in_app_aggregation`)**
- **Cascatas assíncronas (`async_waterfall`)**, excesso de conexões/transações, buffers em RAM e cold starts

## Fluxo em 6 fases com portões determinísticos
1. Pré-varredura com [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) e validação via [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. Baseline local (`>= 1,000` linhas) e `golden_sha256` ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. Caça guiada por cobertura ([`HUNTING.md`](../skills/unslop-backend/HUNTING.md)) e gate `--require-complete`.
4. Correção mínima e comparação via [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs).
5. Verificador cético independente + [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs).
6. Relatórios finais: `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md` e `NEEDS-VALIDATION.md`.

## Estudo de caso real: `louislam/uptime-kuma` (`94.8k★`)

Reprodução real em `node:sqlite` do schema e consultas do upstream (`1cc2fa7`): reduz `getStatusPageData` de **`214 → 7` queries (`-96.7%`)** e `getRSSPageData` de **`314 → 8` (`-97.5%`)** com **paridade exata Golden SHA-256** ([relatório](../examples/case-studies/uptime-kuma/README.md)).

## Instalação e testes

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

Veja o [README principal](../README.md) e o [status de verificação](../docs/STATUS.md) ([Licença MIT](../LICENSE)).
