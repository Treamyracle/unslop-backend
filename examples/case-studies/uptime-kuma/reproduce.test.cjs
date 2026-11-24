"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");

const { runUptimeKumaBenchmark } = require("./reproduce.cjs");
const { compareBenchmarks } = require("../../../skills/unslop-backend/compare-benchmarks.cjs");

describe("louislam/uptime-kuma real SQLite N+1 & missing-index reproduction", () => {
  it("reproduces 214/314 SQL queries and unindexed scans, then proves golden-identical 7/8-query fix", () => {
    const { baseline, after } = runUptimeKumaBenchmark({ iterations: 8, warmup: 2 });
    const fallback = runUptimeKumaBenchmark({ iterations: 2, warmup: 1, forceFallbackStats: true });

    const bMap = new Map(baseline.workloads.map((w) => [w.workload_id, w]));
    const aMap = new Map(after.workloads.map((w) => [w.workload_id, w]));
    const fbBaseMap = new Map(fallback.baseline.workloads.map((w) => [w.workload_id, w]));
    const fbAfterMap = new Map(fallback.after.workloads.map((w) => [w.workload_id, w]));

    const bStatus = bMap.get("uptime-kuma-status-page-data");
    const aStatus = aMap.get("uptime-kuma-status-page-data");
    assert.equal(bStatus.queries_per_req, 214);
    assert.equal(aStatus.queries_per_req, 7);
    assert.ok(bStatus.rows_scanned < 350000 && bStatus.rows_scanned > 300000);
    assert.equal(bStatus.rows_scanned, fbBaseMap.get("uptime-kuma-status-page-data").rows_scanned);
    assert.equal(aStatus.rows_scanned, fbAfterMap.get("uptime-kuma-status-page-data").rows_scanned);
    assert.match(bStatus.explain_plan_type, /\bSCAN\b/);
    assert.match(aStatus.explain_plan_type, /\bSEARCH\b/);
    assert.doesNotMatch(aStatus.explain_plan_type, /\bSCAN\b/);
    assert.equal(aStatus.golden_sha256, bStatus.golden_sha256);

    const bRss = bMap.get("uptime-kuma-rss-page-data");
    const aRss = aMap.get("uptime-kuma-rss-page-data");
    assert.equal(bRss.queries_per_req, 314);
    assert.equal(aRss.queries_per_req, 8);
    assert.equal(bRss.rows_scanned, fbBaseMap.get("uptime-kuma-rss-page-data").rows_scanned);
    assert.equal(aRss.rows_scanned, fbAfterMap.get("uptime-kuma-rss-page-data").rows_scanned);
    assert.match(aRss.explain_plan_type, /COVERING INDEX monitor_time_index/);
    assert.doesNotMatch(aRss.explain_plan_type, /\bSCAN\b/);
    assert.equal(aRss.golden_sha256, bRss.golden_sha256);

    const gate = compareBenchmarks(baseline, after);
    assert.equal(gate.ok, true, `Expected compareBenchmarks gate to pass: ${gate.errors.join("; ")}`);
  });
});
