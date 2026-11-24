"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { validateFindingsData } = require("./validate-findings.cjs");

const HASH_A = "a".repeat(64);
const ROW_HASH = "c".repeat(64);

function makeFixtureEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unslop-find-"));
  fs.writeFileSync(path.join(dir, "server.js"), "1\n2\n3\n4\n5\n6\n7\n8\n9\n10\n");
  const ledger = {
    schema_version: "1.0",
    target_repo: "example/app",
    target_commit: "abc1234",
    generated_at: "2026-11-24T00:00:00Z",
    units: [
      {
        unit_id: "orders-list",
        file: "server.js",
        line_start: 1,
        line_end: 10,
        surface_type: "http_route",
        status: "covered",
        checked_classes: ["n_plus_one_cascade"],
        hunter_run_id: "h-1",
      },
    ],
  };
  const baseline = {
    schema_version: "1.0",
    run_id: "base-1",
    phase: "baseline",
    target_commit: "abc1234",
    captured_at: "2026-11-24T00:00:00Z",
    cache_mode: "warm",
    dataset_rows: 5000,
    iterations: 10,
    warmup_iterations: 2,
    workloads: [
      {
        workload_id: "orders-list",
        endpoint_or_task: "GET /orders",
        command: "node bench.js",
        response_status: 200,
        golden_sha256: HASH_A,
        row_ids_sha256: ROW_HASH,
        queries_per_req: 101,
        rows_scanned: 5000,
        payload_bytes: 12000,
        p50_ms: 15,
        p95_ms: 20,
        p99_ms: 24,
        heap_delta_kb: 400,
        explain_plan_type: "FULL_TABLE_SCAN",
      },
    ],
  };
  const after = {
    ...baseline,
    run_id: "after-1",
    phase: "after",
    workloads: [
      {
        ...baseline.workloads[0],
        queries_per_req: 3,
        rows_scanned: 250,
        p50_ms: 1.0,
        p95_ms: 1.4,
        p99_ms: 1.9,
        heap_delta_kb: 80,
        explain_plan_type: "COMPOSITE_INDEX_SCAN",
      },
    ],
  };
  return { dir, ledger, baseline, after };
}

function validFindingsDoc() {
  return {
    schema_version: "1.0",
    mode: "unslop",
    target_repo: "example/app",
    target_commit: "abc1234",
    generated_at: "2026-11-24T00:00:00Z",
    findings: [
      {
        finding_id: "F-001",
        unit_id: "orders-list",
        slop_class: "n_plus_one_cascade",
        verdict: "fixed",
        severity: "high",
        title: "Batched N+1 user/item lookups on GET /orders",
        summary: "Replaced per-order queries with batched IN lookups.",
        source_trace: [
          { file: "server.js", line_start: 1, line_end: 3, symbol: "getOrders", role: "entrypoint" },
          { file: "server.js", line_start: 4, line_end: 8, symbol: "loadUsers", role: "query_or_io" },
        ],
        skeptic_attempted: true,
        skeptic_notes: "Verified sort order tie-breaker and null user edge cases.",
        workload_id: "orders-list",
        benchmark_command: "node bench.js",
        baseline_metrics: { queries_per_req: 101, rows_scanned: 5000 },
        after_metrics: { queries_per_req: 3, rows_scanned: 250 },
        golden_match: true,
        improvement_summary: "Queries 101 -> 3 (-97.0%), rows_scanned 5000 -> 250 (-95.0%).",
        regression_guard_test: "node --test bench.test.cjs",
      },
      {
        finding_id: "F-002",
        unit_id: "orders-list",
        slop_class: "missing_or_broken_index",
        verdict: "needs_validation",
        severity: null,
        title: "Unmeasured historical billing table query",
        summary: "No local Postgres instance available for EXPLAIN ANALYZE.",
        source_trace: [
          { file: "server.js", line_start: 9, line_end: 10, symbol: "archiveScan", role: "query_or_io" },
        ],
        skeptic_attempted: false,
        skeptic_notes: "Blocked on local PG engine.",
        unresolved_fact: "Exact index plan on production-scale billing_events table.",
        safe_verification_recipe: "Run EXPLAIN (ANALYZE, BUFFERS) against a local seeded Postgres dump.",
      },
    ],
  };
}

describe("validate-findings.cjs", () => {
  it("passes valid findings cross-checked against repo, ledger, baseline, and after", () => {
    const env = makeFixtureEnv();
    try {
      const res = validateFindingsData(validFindingsDoc(), {
        repoRoot: env.dir,
        ledger: env.ledger,
        baseline: env.baseline,
        after: env.after,
      });
      assert.equal(res.ok, true);
      assert.equal(res.summary.fixed, 1);
      assert.equal(res.summary.needs_validation, 1);
    } finally {
      fs.rmSync(env.dir, { recursive: true, force: true });
    }
  });

  it("blocks severity inflation on needs_validation and missing skeptic check on fixed", () => {
    const env = makeFixtureEnv();
    try {
      const bad = validFindingsDoc();
      bad.findings[0].skeptic_attempted = false;
      bad.findings[1].severity = "high";
      const res = validateFindingsData(bad, { repoRoot: env.dir });
      assert.equal(res.ok, false);
      assert.ok(res.errors.some((e) => /skeptic_attempted: true/.test(e)));
      assert.ok(res.errors.some((e) => /severity: null/.test(e)));
    } finally {
      fs.rmSync(env.dir, { recursive: true, force: true });
    }
  });

  it("blocks fixed verdicts in read-only audit mode and catches golden drift via after snapshot", () => {
    const env = makeFixtureEnv();
    try {
      const auditDoc = validFindingsDoc();
      auditDoc.mode = "audit";
      const rAudit = validateFindingsData(auditDoc, { repoRoot: env.dir });
      assert.equal(rAudit.ok, false);
      assert.ok(rAudit.errors.some((e) => /audit" mode/.test(e)));

      env.after.workloads[0].golden_sha256 = "f".repeat(64);
      const rDrift = validateFindingsData(validFindingsDoc(), {
        repoRoot: env.dir,
        ledger: env.ledger,
        baseline: env.baseline,
        after: env.after,
      });
      assert.equal(rDrift.ok, false);
      assert.ok(rDrift.errors.some((e) => /golden_sha256 DRIFT/.test(e)));
    } finally {
      fs.rmSync(env.dir, { recursive: true, force: true });
    }
  });
});
