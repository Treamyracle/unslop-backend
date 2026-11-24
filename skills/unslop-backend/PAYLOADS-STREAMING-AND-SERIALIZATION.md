# Payloads, Projections & Serialization Slop

Load this playbook when endpoints transfer oversized payloads, run `SELECT *`, omit pagination bounds, or burn CPU cloning/serializing JSON.

---

## 1. Common Payload & Projection Anti-Patterns
1. **`SELECT *` pulling cold wide columns:** Fetching `raw_webhook_payload`, `html_body`, `embeddings`, or `audit_trail` JSONB/TEXT columns for a list view or summary calculation that only needs `id`, `status`, and `total_cents`.
2. **Unbounded `findMany()` / `SELECT ...` with no `LIMIT`:** Returns every row in a multi-tenant table once a customer grows past 1,000 rows, blowing memory and HTTP payload budgets.
3. **Redundant deep-cloning & serialization:** `JSON.parse(JSON.stringify(row))`, Python `copy.deepcopy`, or re-parsing JSON strings in tight loops just to drop two keys or clone records.
4. **Uncompressed large JSON/CSV responses:** Missing gzip/brotli negotiation on bulk exports (> 10 KB) or non-streaming array buffering.

---

## 2. Fix Patterns (Contract-Safe vs. Contract-Approved)

- **Internal-only column projection (Zero API change — `golden_sha256` MUST match):**
  - If an endpoint reads `SELECT *` internally to compute KPIs or drops columns in JS/Python before returning HTTP JSON, immediately project only the needed columns in SQL (`SELECT id, user_id, status, total_cents`)! `internal_bytes_read` drops drastically while the HTTP JSON remains **100% byte-identical**.
- **Public contract payload slimming (`contract_projection_approved: true`):**
  - When an endpoint actually sends unused `raw_webhook_payload` blobs to clients (e.g., an export or summary table), confirm whether downstream callers use those fields, project explicit response fields, and verify `row_ids_sha256` matches baseline row ordering and invariant columns in `compare-benchmarks.cjs`.
- **Replace `JSON.parse(JSON.stringify(row))`:**
  - Build explicit DTO object literals (`{ id: row.id, status: row.status, ... }`) rather than deep-cloning massive records.

---

## 3. Skeptic Checklist
- **Undefined vs `null` JSON keys:** Omitting a key (`{ a: undefined }`) vanishes in `JSON.stringify`, whereas `{ a: null }` serializes `"a":null`. Verify `golden_sha256` matches!
- **Pagination defaults:** Never silently change default `limit` from unlimited to `20` on an unversioned endpoint if existing clients expect all items — require explicit contract approval or support cursor pagination.
