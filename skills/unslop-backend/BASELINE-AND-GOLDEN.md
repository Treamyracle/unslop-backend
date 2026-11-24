# Phase 2: Baseline Telemetry & Golden Output Snapshots

Do not touch application code until a deterministic baseline exists. Tiny 5-row unit-test fixtures hide N+1 cascades, `OFFSET` cliffs, and sequential table scans.

---

## 1. Seed Realistic Local Data

- **Minimum recommended scale:** `>= 1,000` rows in primary transactional tables and `>= 3,000` rows in child/line-item tables across multiple tenants (`>= 10` orgs/users) so index selectivity, `N+1` query counts, and overfetched blob sizes diverge clearly from indexed/batched code.
- **Fixed PRNG seed:** Always generate fixtures with a fixed seed so baseline and post-fix benchmarks run against identical rows and data skew.
- **No production data:** Never copy real user PII into local fixtures; synthesize realistic column lengths (e.g., realistic JSONB/TEXT payload blobs where columns exist).

---

## 2. Capture Canonical Golden Outputs (`golden_sha256`)

Compute a canonical SHA-256 hash for every benchmarked workload response before optimization:

1. Parse JSON responses, recursively sort object keys alphabetically while preserving array order (because sort order is part of the API contract!).
2. **Explicit volatile-field normalization:** Only strip or normalize genuinely non-deterministic fields declared in advance (such as `request_id` or wall-clock `generated_at` timestamps when not derived from DB columns). Never strip business fields, counts, totals, cursors, or nested objects.
3. For intentional payload-slimming fixes where unused internal blobs are removed from a response contract (with user/spec sign-off), set `"contract_projection_approved": true` and also record `"row_ids_sha256"` (SHA-256 over the ordered array of returned record IDs and projected invariant columns).

---

## 3. Enforce Fair Paired Measurement (`cache_mode` & Warmup)

Record `baseline.json` matching [`benchmark-schema.json`](benchmark-schema.json):

- **`cache_mode`:** Explicitly declare `"warm"` (run `warmup_iterations >= 3` before `iterations >= 10` so JIT, DB page cache, and connection pools stabilize on BOTH baseline and after runs) or `"cold"` (fresh process / cold-start measurement on BOTH runs).
- **Never mix modes:** `compare-benchmarks.cjs` hard-fails if `baseline.cache_mode !== after.cache_mode` or `baseline.dataset_rows !== after.dataset_rows`.
- **Mandatory metrics per workload:**
  - `queries_per_req` (exact SQL/ORM roundtrips executed per invocation)
  - `rows_scanned` (rows examined by DB engine / in-memory store, NOT merely rows returned)
  - `internal_bytes_read` (bytes pulled from DB/storage into app process before response shaping, when measurable)
  - `payload_bytes` (HTTP response body bytes or output stream bytes)
  - `p50_ms`, `p95_ms`, `p99_ms` (measured across `iterations`)
  - `heap_delta_kb` (process heap growth during workload)
  - `explain_plan_type` (e.g., `FULL_TABLE_SCAN`, `COMPOSITE_INDEX_SCAN`, `COVERING_INDEX_ONLY`, `SEQUENTIAL_IO`, `PARALLEL_FANOUT`)
  - `golden_sha256` & `response_status`

---

## 4. Common Engine Measurement Recipes

- **PostgreSQL:** `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) <query>` + `pg_stat_statements` or query-event listener counting queries per HTTP request.
- **SQLite:** `EXPLAIN QUERY PLAN <query>` (`SCAN` vs `SEARCH ... USING INDEX`) + SQL statement callback counter.
- **MySQL / MariaDB:** `EXPLAIN ANALYZE <query>` + session `Handler_read_rnd_next` / query count hooks.
- **Node.js / Express / Fastify / Hono:** Wrap DB driver/ORM query hook + `process.hrtime.bigint()` + `process.memoryUsage().heapUsed` around loopback `http` requests.
- **Python / FastAPI / Django / SQLAlchemy:** `sqlalchemy` `before_cursor_execute` counter + `tracemalloc` + `time.perf_counter_ns()`.
