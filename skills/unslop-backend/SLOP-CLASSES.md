# Eight Backend Slop Classes (Canonical Taxonomy)

Every finding in `findings.json` and unit `checked_classes` entry in `workload-ledger.json` MUST use one of these 8 canonical identifiers.

---

## 1. `n_plus_one_cascade`
- **Pattern:** Executing a DB query, ORM lazy-load, or internal RPC/HTTP call inside a `for`/`while`/`.map()` loop over parent records (`1` parent query + `N` child queries).
- **Measurable Signal:** `queries_per_req` scales linearly `O(N)` with list size (e.g., 50 items → 51 or 101 queries).
- **Safe Fix:** Hoist child keys into a `Set`, run a single batched `WHERE id IN (...)` / `ANY($1)` / `findMany({ where: { id: { in } } })` query or `JOIN`, and group in an `O(N)` lookup map. Preserve missing-child defaults (`null` vs `[]`).

## 2. `missing_or_broken_index`
- **Pattern:** Filtering, sorting, or joining large tables without a matching composite index, wrapping indexed columns in functions (`LOWER(col)`, `DATE(created_at)`), leading-wildcard `LIKE '%term%'`, or high-page `OFFSET N` scans.
- **Measurable Signal:** `EXPLAIN` shows `Seq Scan` / `FULL_TABLE_SCAN` / `SCAN TABLE` with `rows_scanned >> rows_returned`.
- **Safe Fix:** Create equality-first, sort/range-second composite index `(tenant_id, status, created_at DESC, id DESC)`, rewrite non-SARGable predicates, or use keyset cursor pagination when contract permits. Verify index cardinality and write trade-offs.

## 3. `overfetch_and_payload_bloat`
- **Pattern:** `SELECT *` or ORM queries without `select:` pulling large JSONB/TEXT/audit blobs only to discard them or dump megabytes of unused internal fields over HTTP; unpaginated `.findMany()` / `.objects.all()`.
- **Measurable Signal:** Large `internal_bytes_read` or `payload_bytes` compared to actual rendered/consumed fields.
- **Safe Fix:** Explicitly project required columns in SQL/ORM (`SELECT id, status, total_cents...`), enforce bounded pagination caps, and keep API responses identical unless `contract_projection_approved: true` is signed off.

## 4. `in_app_aggregation`
- **Pattern:** Fetching thousands of raw rows into Node/Python/Go memory to run `.filter()`, `.sort()`, `.slice()`, `.length`, `SUM`, `GROUP BY`, or top-K ranking inside application code.
- **Measurable Signal:** `rows_scanned` and `internal_bytes_read` scale with total table/tenant size while returning a handful of summary KPIs or top-K entries.
- **Safe Fix:** Push predicates, `COUNT`/`SUM`/`GROUP BY`, `ORDER BY ... LIMIT K` into SQL with supporting indexes while preserving exact floating/integer rounding and empty-set (`0` vs `null`) behavior.

## 5. `async_waterfall`
- **Pattern:** Sequential `await` chains across independent DB queries, cache checks, or microservice/HTTP lookups (`a` then `b` then `c` then `d`), or redundant duplicate upstream fetches for identical keys (`thundering herd`).
- **Measurable Signal:** End-to-end `p95_ms` ≈ sum of individual I/O latencies rather than `max(...)`, or identical downstream queries repeated within a request window.
- **Safe Fix:** Fan out independent I/O with `Promise.all` / `asyncio.gather` / `errgroup` (bounded concurrency on dynamic arrays!), or collapse identical concurrent reads with singleflight deduplication. Watch DB connection pool limits when parallelizing!

## 6. `connection_and_tx_bloat`
- **Pattern:** Opening new DB/Redis/HTTP connections per request instead of reusing pooled clients, or holding an active SQL `BEGIN ... COMMIT` transaction open across slow external HTTP/LLM/email calls.
- **Measurable Signal:** High handshake latency per request, pool checkout wait spikes, or long `idle in transaction` durations under load.
- **Safe Fix:** Lift pooled clients/keep-alive agents to module/app lifecycle scope and move slow network/LLM I/O outside transaction boundaries.

## 7. `memory_and_stream_slop`
- **Pattern:** Buffering huge CSV/NDJSON/ZIP exports or file uploads entirely in RAM, `JSON.parse(JSON.stringify(...))` deep cloning inside loops, `readFileSync` in request paths, or unbounded module-level `Map`/`Set`/dict caches that leak until OOM.
- **Measurable Signal:** Spiking `heap_delta_kb` proportional to payload/export row count, event-loop stalls, or monotonic RSS growth.
- **Safe Fix:** Replace full-buffer concatenation with backpressure-aware streams (`Transform` / async generators / chunked cursor batches), drop unnecessary deep clones, and bound caches with explicit LRU eviction + TTL + tenant key prefixes.

## 8. `cold_start_and_bundle_slop`
- **Pattern:** Importing monolithic SDK barrels, unused ML/PDF/icon libraries, or eager DB/client initializers at module top-level on serverless/edge/CLI hot paths; shipping redundant dependency layers.
- **Measurable Signal:** High cold-start `p95_ms` / init memory footprint before handling the first byte of the request.
- **Safe Fix:** Replace barrel imports with subpath imports, lazy-load heavy optional modules inside the specific branch that needs them, and verify cold-start `cache_mode: "cold"` deltas before/after.
