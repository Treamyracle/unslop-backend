<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (Español)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <b>Español</b> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Tu agente entregó el endpoint en 10 minutos. ¿También coló 101 consultas SQL y un escaneo de 15 MB por petición?</b><br>
  Skill de 6 fases orientado a medición para eliminar slop de rendimiento y datos en Claude Code, Codex, Cursor, Google Antigravity y Gemini CLI.<br>
  Cada mejora exige <b>telemetría comparativa antes/después</b> y <b>paridad exacta Golden SHA-256</b>.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## Qué detecta y elimina
- **Cascadas N+1 (`n_plus_one_cascade`)** e **índices ausentes o rotos (`missing_or_broken_index`)**
- **Sobrelectura `SELECT *` (`overfetch_and_payload_bloat`)** y **agregación en aplicación (`in_app_aggregation`)**
- **Cascadas `await` secuenciales (`async_waterfall`)**, exceso de conexiones/transacciones, buffering en memoria y cold starts

## Flujo de 6 fases con validación determinista
1. Pre-escaneo con [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) y ledger validado por [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. Línea base con datos locales (`>= 1,000` filas) y hash canónico `golden_sha256` ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. Caza por unidad ([`HUNTING.md`](../skills/unslop-backend/HUNTING.md)) y puerta `--require-complete`.
4. Corrección mínima sin cambiar contrato y puerta [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs).
5. Verificador escéptico independiente + [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs).
6. Generación de `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md` y `NEEDS-VALIDATION.md`.

## Caso real en código abierto: `louislam/uptime-kuma` (`94.8k★`)

Reproducción real en `node:sqlite` del esquema y consultas originales (`1cc2fa7`): reduce `getStatusPageData` de **`214 → 7` consultas (`-96.7%`)** y `getRSSPageData` de **`314 → 8` (`-97.5%`)** manteniendo **paridad exacta Golden SHA-256** ([ver caso completo](../examples/case-studies/uptime-kuma/README.md)).

## Instalación y pruebas

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

Consulta el [README en inglés](../README.md) y el [estado de verificación](../docs/STATUS.md) ([Licencia MIT](../LICENSE)).
