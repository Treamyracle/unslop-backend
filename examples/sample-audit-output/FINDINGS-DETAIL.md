# Detailed Findings (`examples/sloppy-saas-api` — Real `node:sqlite`)

## `UNSLOP-001` — SQLite Composite Indexes + Batched `IN` Lookups on `GET /api/orgs/:orgId/orders` (`fixed`, `critical`)
- **Slop Class:** `n_plus_one_cascade`
- **Source Trace:** `sloppy-server.js:26-44` → `unslopped-server.js:22-53` + `db.js:241-254`
- **Query Plan Transition:** `SCAN orders | USE TEMP B-TREE FOR ORDER BY | SCAN order_items` → `SEARCH orders USING INDEX idx_orders_org_status_created | SEARCH order_items USING INDEX idx_order_items_order_id`
- **Measured Delta:** Queries `101 → 3 (-97.0%)`, Rows scanned `755,050 → 220 (-100.0%)`, Internal bytes `178,205 B → 12,946 B (-92.7%)`, Uninstrumented p95 `93.45 ms → 2.79 ms (-97.0%)`.
- **Golden Parity:** Exact SHA-256 match (`518473b65f7bc94f4c5330ab89ee111879e17367e588a63e968b20f92d4546fd`).

## `UNSLOP-002` — Covering-Index SQL Aggregation on `GET /api/orgs/:orgId/dashboard` (`fixed`, `high`)
- **Slop Class:** `in_app_aggregation`
- **Source Trace:** `sloppy-server.js:53-83` → `unslopped-server.js:76-103` + `db.js:241-254`
- **Measured Delta:** Queries `6 → 2 (-66.7%)`, Rows examined `5,005 → 505 (-89.9%, covering index idx_orders_org_status_user_total + 5 PK lookups)`, Internal bytes `802,086 B → 378 B (-100.0%)`, Uninstrumented p95 `26.25 ms → 1.29 ms (-95.1%)`.
- **Golden Parity:** Exact SHA-256 match (`e69423346f16975afe9de07d55a5b9b895598058f2f8bb2144ed2d3080e2ed46`).

## `UNSLOP-003` — Parallel `Promise.all` HTTP Fan-Out on `GET /api/orders/:orderId/enrichment` (`fixed`, `high`)
- **Slop Class:** `async_waterfall`
- **Source Trace:** `sloppy-server.js:101-104` → `unslopped-server.js:124-129`
- **Measured Delta:** Uninstrumented p95 latency `31.75 ms → 11.53 ms (-63.7%)` across real loopback keep-alive HTTP + libuv `zlib.gunzip` & `crypto.pbkdf2` shard verification.
- **Golden Parity:** Exact SHA-256 match (`a6c0b0d9b4234227f2b6eaca09ad7b745616ef751f891fccf26bb00f7c24d8e6`).

## `UNSLOP-004` — Explicit Column Projection on `GET /api/orgs/:orgId/orders/export` (`fixed`, `high`)
- **Slop Class:** `overfetch_and_payload_bloat`
- **Source Trace:** `sloppy-server.js:124-135` → `unslopped-server.js:149-155`
- **Measured Delta:** HTTP payload `641,300 B → 29,900 B (-95.3%)`, Rows scanned `5,000 → 200 (-96.0%)`, Uninstrumented p95 `42.35 ms → 1.81 ms (-95.7%)`.
- **Golden Parity:** Approved projection (`contract_projection_approved: true`) with exact `row_ids_sha256` match (`3b15ece1f6e9a310d98056f2364c39379ecd009f30bbe3570a7b6d294b830d7d`).
