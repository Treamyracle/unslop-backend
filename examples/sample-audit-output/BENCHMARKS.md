# Paired Benchmark Comparison (`baseline.json` vs `after.json`)

Paired Benchmark Gate: **PASS** (`cache_mode=warm`, `dataset_rows=5000`, `iterations=15`, `warmup_iterations=3`)

| Workload | Queries (Before → After) | Rows Scanned | Internal / Payload Bytes | p95 Latency | Golden Parity | Gate |
|---|---:|---:|---:|---:|---|---|
| `orders-list` | 101 → 3 (-97.0%) | 755050 → 220 (-100.0%) | 178205B int → 12946B int (-92.7%) | 92.10ms → 3.41ms (-96.3%) | MATCH (SHA-256) | PASS |
| `org-dashboard` | 6 → 2 (-66.7%) | 5005 → 11 (-99.8%) | 802086B int → 378B int (-100.0%) | 36.32ms → 2.12ms (-94.2%) | MATCH (SHA-256) | PASS |
| `order-enrichment` | 4 → 4 (-0.0%) | 4 → 4 (-0.0%) | 390B → 390B (-0.0%) | 37.88ms → 22.46ms (-40.7%) | MATCH (SHA-256) | PASS |
| `orders-export` | 1 → 1 (-0.0%) | 5000 → 200 (-96.0%) | 641300B → 29900B (-95.3%) | 64.91ms → 4.97ms (-92.3%) | MATCH (row IDs) | PASS |
