# SQL Indexes, Query Plans & In-App Aggregation

Load this playbook when auditing SQL schemas, database migrations, raw queries, or list/analytics endpoints.

---

## 1. Reading Query Plans (Always Verify Before & After)

- **PostgreSQL:** `EXPLAIN (ANALYZE, BUFFERS) ...`
  - Red flags: `Seq Scan` with `Rows Removed by Filter >> rows returned`, `Sort Method: external merge Disk`, `Nested Loop` over large unindexed inner sets.
  - Green targets: `Index Scan` or `Index Only Scan`, `Heap Fetches: 0` or low shared buffer reads.
- **SQLite:** `EXPLAIN QUERY PLAN ...`
  - Red flags: `SCAN orders`, `USE TEMP B-TREE FOR ORDER BY`.
  - Green targets: `SEARCH orders USING INDEX idx_... (org_id=? AND status=?)`.
- **MySQL / MariaDB:** `EXPLAIN ANALYZE ...`
  - Red flags: `type: ALL`, `Extra: Using filesort; Using temporary`.

---

## 2. High-Impact SQL Slop Fixes

1. **Equality-First, Sort/Range-Second Composite Indexes:**
   - Query: `WHERE org_id = $1 AND status = $2 ORDER BY created_at DESC, id DESC LIMIT 50`
   - Wrong: single-column index on `(org_id)` or `(status)` alone still scans/sorts thousands of rows.
   - Right: `CREATE INDEX idx_orders_org_status_created ON orders (org_id, status, created_at DESC, id DESC);`
2. **Non-SARGable Predicate Traps:**
   - Slop: `WHERE LOWER(email) = $1` or `WHERE DATE(created_at) = '2026-11-24'` defeats standard B-tree indexes.
   - Fix: Store normalized lowercase email or functional index `ON users (LOWER(email))`; use half-open ranges `WHERE created_at >= $1 AND created_at < $2`.
3. **Partial Indexes for Skewed Queues/Statuses:**
   - Slop: Indexing all 10M rows when queries only poll `WHERE status = 'pending'` (0.2% of table).
   - Fix: `CREATE INDEX idx_jobs_pending ON jobs (run_at, id) WHERE status = 'pending';`
4. **`OFFSET` Pagination Cliff → Keyset Cursors:**
   - `OFFSET 50000 LIMIT 50` forces the DB to walk and discard 50,000 rows. When API contract allows cursor pagination (`?cursor=...`), switch to `(created_at, id) < ($cursor_ts, $cursor_id) ORDER BY created_at DESC, id DESC LIMIT 50`. Keep deterministic tie-breaker `id`!
5. **In-App Aggregation → Indexed SQL Aggregation:**
   - Slop: Loading 2,000 org rows into JS/Python to call `.filter()`, `.reduce()`, and `.sort().slice(0, 5)`.
   - Fix: Single `SELECT COUNT(*), COALESCE(SUM(total_cents), 0) ...` and `GROUP BY user_id ORDER BY total DESC, user_id ASC LIMIT 5`.

---

## 3. Skeptic Checklist
- **`NULL` semantics:** `COUNT(*)` counts rows with nulls; `COUNT(col)` ignores nulls. `SUM()` on zero rows returns `NULL` unless wrapped in `COALESCE(..., 0)`. Match baseline exact types (`0` vs `null`).
- **Tie-breaker drift:** Two rows with identical `created_at` sort arbitrarily without `, id DESC` (or matching tie-breaker from baseline).
- **Index write tax:** Never slap 8 wide indexes onto an append-only audit/telemetry table without weighing `INSERT` amplification.
