<p align="center">
  <img src="../docs/assets/hero-banner.svg" alt="unslop-backend banner" width="900">
</p>

<h1 align="center">unslop-backend (Русский)</h1>

<p align="center">
  <a href="../README.md">English</a> ·
  <a href="README.zh-CN.md">简体中文</a> ·
  <a href="README.ja.md">日本語</a> ·
  <a href="README.ko.md">한국어</a> ·
  <a href="README.tr.md">Türkçe</a> ·
  <a href="README.es.md">Español</a> ·
  <a href="README.fr.md">Français</a> ·
  <a href="README.de.md">Deutsch</a> ·
  <a href="README.pt-BR.md">Português</a> ·
  <a href="README.vi.md">Tiếng Việt</a> ·
  <b>Русский</b>
</p>

<p align="center">
  <b>Ваш ИИ-агент написал эндпоинт за 10 минут. Не добавил ли он туда 101 SQL-запрос и полное сканирование таблицы на 15 МБ?</b><br>
  Шестифазный измеримый навык оптимизации бэкенда для Claude Code, Codex, Cursor, Google Antigravity и Gemini CLI.<br>
  Каждое исправление проходит жёсткую проверку <b>парных замеров до/после</b> и <b>совпадения эталонного хеша Golden SHA-256</b>.
</p>

<p align="center">
  <img src="../docs/assets/benchmark-proof.svg" alt="Before/after benchmark scorecard" width="900">
</p>

## Что находит и устраняет навык
- **Каскады N+1 (`n_plus_one_cascade`)** и **отсутствующие или неработающие индексы (`missing_or_broken_index`)**
- **Избыточные выборки `SELECT *` (`overfetch_and_payload_bloat`)** и **агрегация в памяти приложения (`in_app_aggregation`)**
- **Последовательные каскады `await` (`async_waterfall`)**, раздувание соединений/транзакций, буферизация потоков и холодный старт

## Шестифазный цикл с детерминированными гейтами
1. Предварительный поиск [`scan-slop.cjs`](../skills/unslop-backend/scan-slop.cjs) и проверка реестра [`validate-workload-ledger.cjs`](../skills/unslop-backend/validate-workload-ledger.cjs) ([`RECONNAISSANCE.md`](../skills/unslop-backend/RECONNAISSANCE.md)).
2. Локальный стенд (`>= 1,000` строк) и снятие baseline + `golden_sha256` ([`BASELINE-AND-GOLDEN.md`](../skills/unslop-backend/BASELINE-AND-GOLDEN.md)).
3. Покрытие всех единиц ([`HUNTING.md`](../skills/unslop-backend/HUNTING.md)) и проверка `--require-complete`.
4. Минимальный фикс и парный гейт [`compare-benchmarks.cjs`](../skills/unslop-backend/compare-benchmarks.cjs).
5. Независимый скептик + [`validate-findings.cjs`](../skills/unslop-backend/validate-findings.cjs).
6. Итоговые отчёты: `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md` и `NEEDS-VALIDATION.md`.

## Реальный open-source кейс: `louislam/uptime-kuma` (`94.8k★`)

Воспроизведение реальной схемы и SQL-запросов на `node:sqlite` (`1cc2fa7`): сокращение с **`214 → 7` запросов (`-96.7%`)** в `getStatusPageData` и с **`314 → 8` (`-97.5%`)** в `getRSSPageData` при **точном совпадении Golden SHA-256** ([подробнее](../examples/case-studies/uptime-kuma/README.md)).

## Установка и запуск тестов

```bash
npx skills add https://github.com/Treamyracle/unslop-backend --skill unslop-backend
npm test
node examples/case-studies/uptime-kuma/reproduce.cjs
```

Подробнее в [английском README](../README.md) и [матрице статуса](../docs/STATUS.md) ([лицензия MIT](../LICENSE)).
