# Items Requiring External Environment Validation

No severity is assigned until measured on the target database engine.

## `UNSLOP-005` — Live PostgreSQL `EXPLAIN (ANALYZE, BUFFERS)` Check (`severity: null`)
- **Unit:** `db-access-layer` (`db.js:236-247`)
- **Unresolved Fact:** PostgreSQL `shared_buffers` hit ratio, visibility-map index-only scan efficiency, and write amplification on `idx_orders_org_status_created`.
- **Safe Verification Recipe:**
  1. Seed a disposable local PostgreSQL 17 instance with `>= 100,000` synthetic rows.
  2. Run `EXPLAIN (ANALYZE, BUFFERS)` on the orders query before and after `CREATE INDEX CONCURRENTLY idx_orders_org_status_created ON orders (org_id, status, created_at DESC, id DESC)`.
  3. Confirm `Seq Scan` transitions to `Index Scan` / `Index Only Scan`.
