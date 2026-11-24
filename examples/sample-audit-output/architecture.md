# Architecture Map: `examples/sloppy-saas-api`

- **Target Commit:** `local-sqlite-fixture-v2`
- **Database Engine:** Real on-disk SQLite (`node:sqlite` `DatabaseSync`)
- **Dataset Scale:** `5,000` seeded orders across `20` orgs (`500` users, `15,000` `order_items`, ~3 KB `raw_webhook_payload` & `audit_trail` blobs) + `4` local gzipped NDJSON enrichment shards served over HTTP (`zlib.gunzip` on libuv worker threads)

## Surfaces Mapped (`workload-ledger.json`)
1. `orders-list` (`sloppy-server.js:20-48` -> `unslopped-server.js:17-71`) — `GET /api/orgs/:orgId/orders`
2. `org-dashboard` (`sloppy-server.js:50-96` -> `unslopped-server.js:73-115`) — `GET /api/orgs/:orgId/dashboard`
3. `order-enrichment` (`sloppy-server.js:98-118` -> `unslopped-server.js:117-139`) — `GET /api/orders/:orderId/enrichment`
4. `orders-export` (`sloppy-server.js:120-141` -> `unslopped-server.js:141-156`) — `GET /api/orgs/:orgId/orders/export`
5. `db-access-layer` (`db.js:236-345`) — SQLite schema, `applyOptimizationIndexes()`, `EXPLAIN QUERY PLAN` tracking, and local shard HTTP client
6. `benchmark-harness` (`benchmarks/run-benchmark.cjs:1-196`) — Out of scope (local measurement harness)
