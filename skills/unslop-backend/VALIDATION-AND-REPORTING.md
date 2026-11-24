# Phases 4–6: Prove / Unslop, Fresh Skeptic Verification & Reporting

---

## Phase 4: Prove (Audit Mode) or Minimal Fix + Gate (Unslop Mode)

### In Audit Mode
- Do NOT edit tracked repository files.
- Verify every candidate lead against captured `baseline.json`, query counts, `EXPLAIN` output, or memory/bundle traces.
- Any lead that cannot be locally measured (e.g., external Postgres/ClickHouse missing in local environment) becomes `needs_validation` with `severity: null`.

### In Unslop Mode
1. Create a dedicated working branch before making code edits.
2. Apply the **smallest effective, behavior-preserving fix** per candidate unit (add composite index, hoist N+1 into batched `IN (...)`, project explicit columns, replace sequential independent `await`s with `Promise.all`, stream exports).
3. Add or update a **deterministic regression guard test** (query-count assertion, `EXPLAIN` index check, or golden-equivalence test) so future PRs cannot reintroduce the slop.
4. Re-run the exact same benchmark command and seed scale to produce `after.json`, then enforce the paired gate:

```bash
node <skill-dir>/compare-benchmarks.cjs <output-dir>/baseline.json <output-dir>/after.json
```

If `compare-benchmarks.cjs` fails (golden SHA-256 mismatch, status change, cache-mode mismatch, or gain below noise floor), revert or refine the fix before proceeding.

---

## Phase 5: Fresh Skeptic Verification

Send each `confirmed` or `fixed` record to an independent fresh verifier (never the hunter or patch author) whose explicit mandate is to **disprove** the finding or break the fix:

1. **Line & symbol audit:** Confirm every `file:line` and `symbol` matches real files on disk.
2. **Cache & dataset fairness:** Confirm `baseline.json` and `after.json` used identical `cache_mode`, `dataset_rows`, and seeded inputs.
3. **Semantic corner cases:**
   - Does replacing `OFFSET` or in-app `Array.sort` preserve exact tie-breaker order (`ORDER BY created_at DESC, id DESC`)?
   - Does batching or moving filters into SQL preserve `NULL`, empty-set, `undefined`, and soft-delete semantics?
   - Do any added caches isolate keys by `tenant_id` / `org_id` / `user_id` / `role` and bound memory with explicit `maxSize` + TTL?
   - Does a new DB index impose unacceptable write amplification on an insert-heavy audit log table?
4. **Emit `findings.json`** matching [`report-schema.json`](report-schema.json) and run the validator gate:

```bash
node <skill-dir>/validate-findings.cjs \
  --repo-root <repo-root> \
  --ledger <output-dir>/workload-ledger.json \
  --baseline <output-dir>/baseline.json \
  --after <output-dir>/after.json \
  <output-dir>/findings.json
```

---

## Phase 6: Target-Neutral Reports

Generate all four Markdown reports strictly from validated JSON artifacts:

1. **`REPORT.md`**: Executive summary, target commit, mode, dataset scale, confirmed/fixed table, rejected false-positive count, and overall telemetry reduction.
2. **`BENCHMARKS.md`**: Direct Markdown output of `compare-benchmarks.cjs` showing `Queries`, `Rows Scanned`, `Internal Bytes`, `Payload Bytes`, `p95 ms`, `Explain Plan`, and `Golden SHA-256` (`MATCH` / `DRIFT`) per workload.
3. **`FINDINGS-DETAIL.md`**: Per-finding breakdown with exact `source_trace` hops, root cause, minimal diff/remediation, baseline vs after numbers, skeptic verification notes, and regression guard test command.
4. **`NEEDS-VALIDATION.md`**: Every unresolved `needs_validation` lead (`severity: null`), exact `unresolved_fact`, and copy-pasteable `safe_verification_recipe`.
