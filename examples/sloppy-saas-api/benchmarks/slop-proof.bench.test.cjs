"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { runBenchmark } = require("./run-benchmark.cjs");
const { compareBenchmarks } = require("../../../skills/unslop-backend/compare-benchmarks.cjs");

describe("sloppy-saas-api real node:sqlite & libuv I/O parity proof", () => {
  it("proves real SQLite SCAN -> SEARCH USING INDEX improvements with exact golden parity", async () => {
    const baseline = await runBenchmark({ mode: "sloppy", iterations: 12, warmup: 3 });
    const after = await runBenchmark({ mode: "unslopped", iterations: 12, warmup: 3 });

    const bMap = new Map(baseline.workloads.map((w) => [w.workload_id, w]));
    const aMap = new Map(after.workloads.map((w) => [w.workload_id, w]));

    // 1. Real SQLite SCAN orders -> SEARCH orders USING INDEX + 101 -> 3 queries
    const ordB = bMap.get("orders-list");
    const ordA = aMap.get("orders-list");
    assert.equal(ordB.queries_per_req, 101);
    assert.match(ordB.explain_plan_type, /\bSCAN orders\b/);
    assert.equal(ordA.queries_per_req, 3);
    assert.match(ordA.explain_plan_type, /\bSEARCH orders USING INDEX idx_orders_org_status_created\b/);
    assert.equal(ordA.golden_sha256, ordB.golden_sha256);

    // 2. Real SQLite SELECT * + JS agg -> indexed SQL aggregation (honest aggregate index-row count)
    const dashB = bMap.get("org-dashboard");
    const dashA = aMap.get("org-dashboard");
    const dashFallback = await runBenchmark({ mode: "unslopped", iterations: 1, warmup: 1, forceFallbackStats: true });
    const dashAFallback = dashFallback.workloads.find((w) => w.workload_id === "org-dashboard");
    assert.equal(dashB.queries_per_req, 6);
    assert.equal(dashA.queries_per_req, 2);
    assert.ok(dashA.rows_scanned >= 250 && dashA.rows_scanned < 1000);
    assert.equal(dashA.rows_scanned, dashAFallback.rows_scanned);
    assert.ok(dashB.internal_bytes_read > 500000);
    assert.ok(dashA.internal_bytes_read < 10000);
    assert.equal(dashA.golden_sha256, dashB.golden_sha256);

    // 3. Real HTTP + libuv gunzip enrichment waterfall -> Promise.all
    const enrB = bMap.get("order-enrichment");
    const enrA = aMap.get("order-enrichment");
    assert.ok(enrA.p95_ms < enrB.p95_ms * 0.8);
    assert.equal(enrA.golden_sha256, enrB.golden_sha256);

    // 4. Real SQLite blob export -> indexed summary projection
    const expB = bMap.get("orders-export");
    const expA = aMap.get("orders-export");
    assert.ok(expB.payload_bytes > 500000);
    assert.ok(expA.payload_bytes < 50000);
    assert.equal(expA.row_ids_sha256, expB.row_ids_sha256);

    // 5. Strict paired comparator gate passes across all 4 workloads
    const gate = compareBenchmarks(baseline, after);
    assert.equal(gate.ok, true, `Expected compareBenchmarks gate to pass: ${gate.errors.join("; ")}`);
    assert.equal(gate.comparisons.length, 4);
  });
});
