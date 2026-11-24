# Paired Benchmark Comparison (`baseline.json` vs `after.json`)

Paired Benchmark Gate: **PASS** (`cache_mode=warm`, `dataset_rows=5000`, `iterations=21`, `warmup_iterations=4`, uninstrumented latency pass decoupled from telemetry pass)

| Workload | Queries (Before → After) | Rows Examined | Internal / Payload Bytes | Uninstrumented p95 | Golden Parity | Gate |
|---|---:|---:|---:|---:|---|---|
| `orders-list` | 101 → 3 (-97.0%) | 755050 → 220 (-100.0%) | 178205B int → 12946B int (-92.7%) | 93.45ms → 2.79ms (-97.0%) | MATCH (SHA-256) | PASS |
| `org-dashboard` | 6 → 2 (-66.7%) | 5005 → 505 (-89.9%) | 802086B int → 378B int (-100.0%) | 26.25ms → 1.29ms (-95.1%) | MATCH (SHA-256) | PASS |
| `order-enrichment` | 4 → 4 (-0.0%) | 4 → 4 (-0.0%) | 390B → 390B (-0.0%) | 31.75ms → 11.53ms (-63.7%) | MATCH (SHA-256) | PASS |
| `orders-export` | 1 → 1 (-0.0%) | 5000 → 200 (-96.0%) | 641300B → 29900B (-95.3%) | 42.35ms → 1.81ms (-95.7%) | MATCH (row IDs) | PASS |
