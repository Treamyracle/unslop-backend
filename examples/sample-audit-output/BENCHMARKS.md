# Paired Benchmark Comparison (`baseline.json` vs `after.json`)

Paired Benchmark Gate: **PASS** (`cache_mode=warm`, `dataset_rows=5000`, `iterations=21`, `warmup_iterations=4`, uninstrumented latency pass decoupled from telemetry pass)

| Workload | Queries (Before → After) | Rows Examined | Internal / Payload Bytes | Uninstrumented p95 | Golden Parity | Gate |
|---|---:|---:|---:|---:|---|---|
| `orders-list` | 101 → 3 (-97.0%) | 755050 → 220 (-100.0%) | 178205B int → 12946B int (-92.7%) | 80.47ms → 1.93ms (-97.6%) | MATCH (SHA-256) | PASS |
| `org-dashboard` | 6 → 2 (-66.7%) | 5005 → 505 (-89.9%) | 802086B int → 378B int (-100.0%) | 26.84ms → 1.10ms (-95.9%) | MATCH (SHA-256) | PASS |
| `order-enrichment` | 4 → 4 (-0.0%) | 4 → 4 (-0.0%) | 390B → 390B (-0.0%) | 57.20ms → 26.45ms (-53.8%) | MATCH (SHA-256) | PASS |
| `orders-export` | 1 → 1 (-0.0%) | 5000 → 200 (-96.0%) | 641300B → 29900B (-95.3%) | 34.36ms → 3.28ms (-90.5%) | MATCH (row IDs) | PASS |
