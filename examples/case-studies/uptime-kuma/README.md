# Real Open-Source Case Study: `louislam/uptime-kuma` (`94.8k★`)

- **Upstream Repository:** <https://github.com/louislam/uptime-kuma>
- **Upstream Commit Audited:** [`1cc2fa7b1c9ec2be8e610167c8208309283177f2`](https://github.com/louislam/uptime-kuma/tree/1cc2fa7b1c9ec2be8e610167c8208309283177f2) (`2026-11-23`)
- **Database Engine:** Real on-disk SQLite (`node:sqlite` `DatabaseSync`) using Uptime Kuma's exact schema and indexes from `db/knex_init_db.js`.

---

## 1. Real Slop Discovered in Upstream Code

Running [`scan-slop.cjs`](../../../skills/unslop-backend/scan-slop.cjs) plus Phase 1/3 ORM tracing on `louislam/uptime-kuma/server/model/` uncovered a **three-level nested SQL N+1 cascade** combined with **missing SQLite foreign-key indexes**:

1. **Static pre-scanner hit (`status_page.js:284`):**
   `StatusPage.getRSSPageData` calls `StatusPage.getStatusPageData`, then loops every monitor across every public group calling `await R.findOne("heartbeat", "monitor_id = ? ORDER BY time DESC", [monitor.id])` (`1` query per monitor).
2. **Multi-hop ORM N+1 cascade (`status_page.js:331-336` → `group.js:13-46` → `monitor.js:89-112,278-307`):**
   - `getStatusPageData` queries `group` (`status_page_id = ?` — **unindexed** in `db/knex_init_db.js:26-34`).
   - Each group calls `Group.getMonitorList()`, running `SELECT monitor.*, monitor_group.send_url, monitor_group.custom_url ... WHERE group_id = ?` (**overfetching all wide monitor columns**, while `monitor_group` only indexes `(monitor_id, group_id)` in `db/knex_init_db.js:269` — wrong leading column!).
   - Each monitor calls `Monitor.toPublicJSON()`, which runs **two per-monitor SQL queries**:
     - `Monitor.getTags()`: `SELECT mt.*, tag.name, tag.color FROM monitor_tag mt JOIN tag ... WHERE mt.monitor_id = ?` — **`monitor_tag` has ZERO indexes** in `db/knex_init_db.js:337-356`, triggering `SCAN mt` (`3,000` rows per call)!
     - `Monitor.getCertExpiry()`: `SELECT * FROM monitor_tls_info WHERE monitor_id = ?` — **`monitor_tls_info` has ZERO indexes** in `db/knex_init_db.js:359-370`, triggering `SCAN monitor_tls_info` (`1,000` rows per call)!

---

## 2. Reproducible Real-SQLite Benchmark Results (`10` Groups, `100` Monitors, `25,000` Heartbeats)

Run it yourself locally in under 2 seconds (Node `>= 22.5`, zero dependencies):

```bash
node examples/case-studies/uptime-kuma/reproduce.cjs
node --test examples/case-studies/uptime-kuma/reproduce.test.cjs
```

Captured snapshots: [`baseline.json`](baseline.json) vs [`after.json`](after.json) gated by [`compare-benchmarks.cjs`](../../../skills/unslop-backend/compare-benchmarks.cjs):

| Workload | SQLite Queries (Before → After) | Rows Scanned | Internal Bytes Read | Real SQLite p95 | Golden Parity | Gate |
|---|---:|---:|---:|---:|---|---|
| `StatusPage.getStatusPageData` | `214 → 7 (-96.7%)` | `410,504 → 915 (-99.8%)` | `374,202 B → 185,814 B (-50.3%)` | `63.91 ms → 5.89 ms (-90.8%)` | `MATCH (SHA-256)` | **PASS** |
| `StatusPage.getRSSPageData` | `314 → 8 (-97.5%)` | `410,604 → 1,015 (-99.8%)` | `385,352 B → 192,107 B (-50.1%)` | `95.26 ms → 10.40 ms (-89.1%)` | `MATCH (SHA-256)` | **PASS** |

### Exact `EXPLAIN QUERY PLAN` Transition
- **Before:** `SCAN incident`, `SCAN maintenance_status_page`, `SCAN group`, `SCAN mt` (`monitor_tag` × 100), `SCAN monitor_tls_info` (`× 100`), `USE TEMP B-TREE FOR ORDER BY`.
- **After:** `SEARCH incident USING INDEX idx_incident_status_pin_active`, `SEARCH maintenance_status_page USING INDEX idx_maintenance_sp`, `SEARCH group USING INDEX idx_group_status_page_public_weight`, `SEARCH mg USING INDEX idx_monitor_group_group_weight`, `SEARCH mt USING INDEX idx_monitor_tag_monitor`, `SEARCH monitor_tls_info USING INDEX idx_monitor_tls_info_monitor`, batched `WHERE ... IN (...)`, explicit column projection (no `SELECT monitor.*`), and single-query `ROW_NUMBER() OVER (PARTITION BY monitor_id ORDER BY time DESC)` for RSS heartbeats.
