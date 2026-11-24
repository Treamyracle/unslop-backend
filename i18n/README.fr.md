<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (Français)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <b>Français</b> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <a href="README.ru.md">Русский</a>
</p>

<p align="center">
  <b>Votre agent a livré l’API en 10 minutes. A-t-il aussi glissé 101 requêtes SQL et un scan de 15 Mo par appel ?</b><br>
  Une skill en 6 phases guidée par la mesure pour éliminer le slop backend sous Claude Code, Codex, Cursor, Google Antigravity et Gemini CLI.<br>
  Chaque optimisation est bloquée sans <b>télémétrie avant/après appariée</b> et <b>parité exacte Golden SHA-256</b>.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## Ce que `unslop-backend` élimine
- **Cascades N+1 (`n_plus_one_cascade`)** et **index manquants ou non SARGables (`missing_or_broken_index`)**
- **Sur-lecture `SELECT *` (`overfetch_and_payload_bloat`)** et **agrégation applicative (`in_app_aggregation`)**
- **Cascades `await` séquentielles (`async_waterfall`)**, fuites mémoire/streams, connexions non poolées et cold starts

## Pipeline vérifié en 6 phases
1. Pré-scan statique [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) et validation du registre [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. Capture locale (`>= 1,000` lignes) et empreinte canonique `golden_sha256` ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. Chasse par unité ([`HUNTING.md`](../skills/unslop-backend/HUNTING.md)) et porte `--require-complete`.
4. Correction minimale puis porte [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs).
5. Vérificateur sceptique indépendant + [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs).
6. Rapports neutres : `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md` et `NEEDS-VALIDATION.md`.

## Étude de cas open-source : `louislam/uptime-kuma` (`94.8k★`)

Reproduction réelle sur `node:sqlite` du schéma et des requêtes amont (`1cc2fa7`) : **`214 → 7` requêtes (`-96.7%`)** sur `getStatusPageData` et **`314 → 8` (`-97.5%`)** sur `getRSSPageData` avec **parité exacte Golden SHA-256** ([détails](../examples/case-studies/uptime-kuma/README.md)).

## Installation et tests

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

Voir le [README principal](../README.md) et la [matrice de statut](../docs/STATUS.md) ([Licence MIT](../LICENSE)).
