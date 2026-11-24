# Backend Unslop Report: `examples/sloppy-saas-api` (Real `node:sqlite`)

- **Mode:** `unslop` (behavior-preserving optimization + golden SHA-256 verification)
- **Target Commit:** `local-sqlite-fixture-v2`
- **Database & I/O:** Real on-disk SQLite (`node:sqlite` `DatabaseSync`, `5,000` orders / `15,000` items) + real local HTTP `.ndjson.gz` shard reads (`zlib.gunzip`); wall-clock p95 measured on an uninstrumented pass decoupled from telemetry/plan inspection
- **Ledger Coverage:** `5 / 5` in-scope units covered (`100%`), `1` out of scope (`benchmark-harness`)

## Summary of Verdicts

| Finding | Slop Class | Verdict | Severity | Measured Impact |
|---|---|---|---|---|
| `UNSLOP-001` | `n_plus_one_cascade` | **fixed** | critical | Queries `101 → 3 (-97.0%)`, rows scanned `755,050 → 220 (-100.0%)`, p95 `95.59 ms → 1.99 ms (-97.9%)`, `golden_sha256` MATCH |
| `UNSLOP-002` | `in_app_aggregation` | **fixed** | high | Queries `6 → 2 (-66.7%)`, rows examined `5,005 → 505 (-89.9% covering index)`, internal bytes `802.1 KB → 378 B (-100.0%)`, p95 `25.68 ms → 1.06 ms (-95.9%)`, `golden_sha256` MATCH |
| `UNSLOP-003` | `async_waterfall` | **fixed** | high | Parallel libuv `zlib.gunzip` HTTP p95 `35.63 ms → 16.56 ms (-53.5%)`, `golden_sha256` MATCH |
| `UNSLOP-004` | `overfetch_and_payload_bloat` | **fixed** | high | HTTP payload `641.3 KB → 29.9 KB (-95.3%)`, p95 `34.75 ms → 2.59 ms (-92.5%)`, `row_ids_sha256` MATCH |
| `UNSLOP-005` | `missing_or_broken_index` | `needs_validation` | — | Live PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` verification (see `NEEDS-VALIDATION.md`) |
| `UNSLOP-006` | `memory_and_stream_slop` | `rejected` | — | Bounded 10.5 KB JSON response; NDJSON rewrite rejected |
