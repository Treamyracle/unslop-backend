"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { compareBenchmarks } = require("./compare-benchmarks.cjs");

const HASH_A = "a".repeat(64);
const HASH_B = "b".repeat(64);
const ROW_HASH = "c".repeat(64);

function makeSnapshot(phase, overrides = {}, workloadOverrides = {}) {
  return {
    schema_version: "1.0",
    run_id: `run-${phase}`,
    phase,
    target_commit: "abc1234",
    captured_at: "2026-11-24T00:00:00Z",
    cache_mode: "warm",
    dataset_rows: 5000,
    iterations: 15,
    warmup_iterations: 3,
    workloads: [
      {
        workload_id: "orders-list",
        endpoint_or_task: "GET /api/orgs/org-1/orders",
        command: "node run-benchmark.cjs",
        response_status: 200,
        golden_sha256: HASH_A,
        row_ids_sha256: ROW_HASH,
        queries_per_req: phase === "baseline" ? 101 : 3,
        rows_scanned: phase === "baseline" ? 5200 : 250,
        internal_bytes_read: phase === "baseline" ? 2200000 : 42000,
        payload_bytes: 28000,
        p50_ms: phase === "baseline" ? 18.0 : 1.2,
        p95_ms: phase === "baseline" ? 24.0 : 1.8,
        p99_ms: phase === "baseline" ? 28.0 : 2.1,
        heap_delta_kb: phase === "baseline" ? 800 : 120,
        explain_plan_type: phase === "baseline" ? "FULL_TABLE_SCAN" : "COMPOSITE_INDEX_SCAN",
        ...workloadOverrides,
      },
    ],
    ...overrides,
  };
}

describe("compare-benchmarks.cjs", () => {
  it("passes when golden SHA-256 matches and metrics beat noise floors", () => {
    const res = compareBenchmarks(makeSnapshot("baseline"), makeSnapshot("after"));
    assert.equal(res.ok, true);
    assert.equal(res.comparisons[0].golden_match, true);
    assert.ok(res.comparisons[0].wins.length >= 3);
  });

  it("hard-fails when golden_sha256 drifts without approved projection", () => {
    const res = compareBenchmarks(
      makeSnapshot("baseline"),
      makeSnapshot("after", {}, { golden_sha256: HASH_B })
    );
    assert.equal(res.ok, false);
    assert.match(res.errors[0], /golden_sha256 DRIFT/);
  });

  it("allows deliberate payload slimming when contract_projection_approved=true and row_ids_sha256 matches", () => {
    const res = compareBenchmarks(
      makeSnapshot("baseline", {}, { payload_bytes: 400000 }),
      makeSnapshot(
        "after",
        {},
        {
          golden_sha256: HASH_B,
          payload_bytes: 18000,
          contract_projection_approved: true,
        }
      )
    );
    assert.equal(res.ok, true);
    assert.equal(res.comparisons[0].golden_mode, "row_ids_projection");
  });

  it("hard-fails on unfair cache_mode or dataset_rows comparisons", () => {
    const rCache = compareBenchmarks(
      makeSnapshot("baseline", { cache_mode: "cold" }),
      makeSnapshot("after", { cache_mode: "warm" })
    );
    assert.equal(rCache.ok, false);
    assert.match(rCache.errors[0], /cache_mode mismatch/);

    const rRows = compareBenchmarks(
      makeSnapshot("baseline", { dataset_rows: 5000 }),
      makeSnapshot("after", { dataset_rows: 100 })
    );
    assert.equal(rRows.ok, false);
    assert.match(rRows.errors[0], /dataset_rows mismatch/);
  });

  it("hard-fails when improvements stay below noise floor or regress a primary count", () => {
    const noopBase = makeSnapshot("baseline", {}, {
      queries_per_req: 3,
      rows_scanned: 100,
      internal_bytes_read: 5000,
      payload_bytes: 4000,
      p95_ms: 10.0,
      heap_delta_kb: 20,
    });
    const noopAfter = makeSnapshot("after", {}, {
      queries_per_req: 3,
      rows_scanned: 98,
      internal_bytes_read: 4950,
      payload_bytes: 4000,
      p95_ms: 9.7,
      heap_delta_kb: 20,
    });
    const rNoop = compareBenchmarks(noopBase, noopAfter);
    assert.equal(rNoop.ok, false);
    assert.match(rNoop.errors[0], /noise floor/);

    const rReg = compareBenchmarks(
      makeSnapshot("baseline"),
      makeSnapshot("after", {}, { payload_bytes: 45000 })
    );
    assert.equal(rReg.ok, false);
    assert.match(rReg.errors[0], /payload_bytes regressed/);
  });

  it("exits non-zero on invalid CLI comparison and zero on valid comparison", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unslop-cmp-"));
    const basePath = path.join(tmp, "baseline.json");
    const afterPath = path.join(tmp, "after.json");
    try {
      fs.writeFileSync(basePath, JSON.stringify(makeSnapshot("baseline")));
      fs.writeFileSync(afterPath, JSON.stringify(makeSnapshot("after")));
      const out = execFileSync(
        process.execPath,
        [path.join(__dirname, "compare-benchmarks.cjs"), "--json", basePath, afterPath],
        { encoding: "utf-8" }
      );
      assert.equal(JSON.parse(out).ok, true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
