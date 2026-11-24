# Phase 3: Coverage-Led Slop Hunting & Coverage Critic

Assign units from `workload-ledger.json` to isolated hunter subagents paired with [`SLOP-CLASSES.md`](SLOP-CLASSES.md) and the stack's domain playbooks.

---

## Hunter Assignment Rules

1. **Batch by surface & domain:** Group related routes, repositories, and migrations (e.g., `orders` route + `orders` repo + `orders` migration) so a hunter sees the full path from HTTP entrypoint down to DB indexes.
2. **Trace the complete read/write path:**
   - Entrypoint parameters, defaults, and pagination limits
   - ORM/SQL query construction, projections, joins, and index coverage
   - Post-query app-layer filtering, sorting, grouping, and serialization
   - External HTTP / LLM / storage calls (sequential vs concurrent, cached vs uncached)
3. **Check every relevant `slop_class`:** Record all inspected classes in `checked_classes` on the unit even when no slop is found, and assign `hunter_run_id` and `status: "covered"`.

---

## Required Evidence for a Candidate Lead

A hunter may only propose a candidate finding if it includes:
- `unit_id` from `workload-ledger.json`
- `slop_class` (one of the 8 canonical classes)
- Complete `source_trace` (`file`, `line_start`, `line_end`, `symbol`, `role`) read directly in the current session
- Hypothesis tying the code path to measurable waste (query multiplier `O(N)`, unindexed predicate scan `O(table)`, blob overfetch bytes, or serialized `O(k)` I/O latency)
- Minimal behavior-preserving optimization plan (or explicit safe-verification recipe when local execution is blocked)

---

## Coverage Critic Pass

Before entering Phase 4, run a fresh `research` Coverage Critic over `workload-ledger.json`, `architecture.md`, and `baseline.json`:
- Verify no high-traffic `http_route`, `export_stream`, `background_job`, or `ai_pipeline` was marked `out_of_scope` improperly.
- Verify baseline measurements actually reflect the slow endpoints (if an endpoint showed `queries_per_req > 10` or `rows_scanned >= 1,000` in Phase 2, ensure its unit was hunted!).
- Run the mandatory completeness gate:

```bash
node <skill-dir>/validate-workload-ledger.cjs --repo-root <repo-root> --require-complete <output-dir>/workload-ledger.json
```

Exit code `1` blocks progression to Phase 4 until all in-scope units are covered.
