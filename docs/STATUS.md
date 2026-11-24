# Implementation Status & Verification Matrix (Radical Honesty)

> Last verified locally on Windows with Node.js v26.13.1; GitHub Actions matrix covers `ubuntu-latest`, `macos-latest`, and `windows-latest` across Node `22` and `24` (where built-in `node:sqlite` requires zero `npm install`).

| Component | Status | Verified By | Honest Scope / Boundary |
|---|---|---|---|
| **Core 6-phase workflow & 8 slop classes** | ✅ Works | `SKILL.md` + 11 workflow & stack playbooks | Instruction & verification harness driven by your local coding agent |
| **`scan-slop.cjs` static pre-scanner** | ✅ Works | `node --test skills/unslop-backend/scan-slop.test.cjs` + live scan on `louislam/uptime-kuma/server/model` (`6` leads) | Regex/indent heuristics across JS/TS/Python/Go/Ruby/SQL; emits `candidate_only: true` leads only |
| **`validate-workload-ledger.cjs` gate** | ✅ Works | `node --test skills/unslop-backend/validate-workload-ledger.test.cjs` | Enforces schema, unique `unit_id`, symlink-safe repo-relative paths, real line bounds, and `--require-complete` |
| **`compare-benchmarks.cjs` paired gate** | ✅ Works | `node --test skills/unslop-backend/compare-benchmarks.test.cjs` | Hard-fails on `golden_sha256` drift, `cache_mode` / `dataset_rows` mismatch, regression `>15%`, or sub-noise deltas |
| **`validate-findings.cjs` cross-checker** | ✅ Works | `node --test skills/unslop-backend/validate-findings.test.cjs` | Cross-checks `source_trace` lines, `workload-ledger.json`, `baseline.json`, and `after.json`; enforces `severity: null` on unresolved/rejected leads |
| **Real OSS Case Study: `louislam/uptime-kuma` (`94.8k★`)** | ✅ Works | `examples/case-studies/uptime-kuma/reproduce.test.cjs` | Reproduces schema & SQL queries from commit `1cc2fa7b1c` on real `node:sqlite` with uninstrumented latency timing, real `stmt.stat("fullscanStep")` / `LIMIT 1` row accounting, `apicache` miss-path disclosure, `214 → 7` & `314 → 8` queries, and `golden_sha256` match |
| **Real SQLite CI Fixture (`sloppy-saas-api`)** | ✅ Works | `examples/sloppy-saas-api/benchmarks/slop-proof.bench.test.cjs` + `npm run validate:sample` | Self-contained keep-alive `node:http` + `node:sqlite` + libuv `.ndjson.gz` `gunzip`/`pbkdf2` shard verification (`zero setTimeout`, `zero mocks`); uninstrumented timing decoupled from telemetry/aggregate `COUNT(*)` index-row counting |
| **Live PostgreSQL / MySQL `EXPLAIN ANALYZE`** | ⚠️ Requires target DB | Playbooks (`SQL-INDEXES-AND-QUERY-PLANS.md`, `BASELINE-AND-GOLDEN.md`) | `unslop-backend` does not ship a Postgres/MySQL server; when unavailable locally, leads stay `needs_validation` (`severity: null`) |
| **Repo manifests, SVGs & 10-language READMEs** | ✅ Works | `node scripts/check-repo.cjs` | Checks JSON syntax, relative links across all READMEs/skills/case-studies, SVG `viewBox`, gradient refs, and text fit |
