#!/usr/bin/env node
"use strict";

/**
 * Real SQLite + loopback HTTP benchmark harness for examples/sloppy-saas-api.
 * Usage: node run-benchmark.cjs --mode sloppy|unslopped [--out <path.json>] [--iterations 15] [--warmup 3]
 */

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");

const { createRealSqliteDb, canonicalJsonSha256 } = require("../db.js");
const { createSloppyServer } = require("../sloppy-server.js");
const { createUnsloppedServer } = require("../unslopped-server.js");

const WORKLOAD_DEFS = [
  {
    workload_id: "orders-list",
    endpoint_or_task: "GET /api/orgs/org-1/orders?status=paid&limit=50",
    path: "/api/orgs/org-1/orders?status=paid&limit=50",
    contract_projection_approved: false,
  },
  {
    workload_id: "org-dashboard",
    endpoint_or_task: "GET /api/orgs/org-1/dashboard",
    path: "/api/orgs/org-1/dashboard",
    contract_projection_approved: false,
  },
  {
    workload_id: "order-enrichment",
    endpoint_or_task: "GET /api/orders/ord-00001/enrichment",
    path: "/api/orders/ord-00001/enrichment",
    contract_projection_approved: false,
  },
  {
    workload_id: "orders-export",
    endpoint_or_task: "GET /api/orgs/org-1/orders/export?limit=200",
    path: "/api/orgs/org-1/orders/export?limit=200",
    contract_projection_approved: true,
  },
];

function requestJson(baseUrl, reqPath, headers = {}) {
  return new Promise((resolve, reject) => {
    const start = process.hrtime.bigint();
    http
      .get(`${baseUrl}${reqPath}`, { headers }, (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
          const bodyBuf = Buffer.concat(chunks);
          let parsed = null;
          try {
            parsed = JSON.parse(bodyBuf.toString("utf8"));
          } catch (err) {
            return reject(err);
          }
          resolve({
            status: res.statusCode,
            durationMs,
            payloadBytes: bodyBuf.length,
            queries: Number(res.headers["x-unslop-queries"] || 0),
            rowsScanned: Number(res.headers["x-unslop-rows-scanned"] || 0),
            internalBytes: Number(res.headers["x-unslop-internal-bytes"] || 0),
            plan: String(res.headers["x-unslop-plan"] || "UNKNOWN"),
            body: parsed,
          });
        });
      })
      .on("error", reject);
  });
}

function percentile(sortedNums, p) {
  if (sortedNums.length === 0) return 0;
  const idx = Math.min(
    sortedNums.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedNums.length) - 1)
  );
  return Number(sortedNums[idx].toFixed(3));
}

function computeRowIdsHash(body) {
  if (!body || !Array.isArray(body.rows)) return null;
  const projection = body.rows.map((r) => ({
    id: r.id,
    org_id: r.org_id,
    user_id: r.user_id,
    status: r.status,
    total_cents: r.total_cents,
    created_at: r.created_at,
  }));
  return canonicalJsonSha256({ org_id: body.org_id, rows: projection });
}

async function runBenchmark({ mode, iterations = 15, warmup = 3, forceFallbackStats = false } = {}) {
  const db = createRealSqliteDb({
    seed: 20261124,
    withIndexes: mode === "unslopped",
    forceFallbackStats,
  });
  await db.start();

  const server = mode === "sloppy" ? createSloppyServer(db) : createUnsloppedServer(db);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const addr = server.address();
  const baseUrl = `http://127.0.0.1:${addr.port}`;

  try {
    const workloads = [];

    for (const def of WORKLOAD_DEFS) {
      for (let w = 0; w < warmup; w += 1) {
        await requestJson(baseUrl, def.path);
      }

      const durations = [];
      const heapBefore = process.memoryUsage().heapUsed;
      let lastTimedRes = null;

      for (let i = 0; i < iterations; i += 1) {
        lastTimedRes = await requestJson(baseUrl, def.path);
        durations.push(lastTimedRes.durationMs);
      }

      const heapDeltaKb = Number(
        Math.max(0, (process.memoryUsage().heapUsed - heapBefore) / 1024).toFixed(2)
      );
      durations.sort((a, b) => a - b);

      // Separate un-timed telemetry request so EXPLAIN/JSON byte counting never slows measured latency
      const telemetryRes = await requestJson(baseUrl, def.path, { "x-unslop-telemetry": "1" });
      if (canonicalJsonSha256(lastTimedRes.body) !== canonicalJsonSha256(telemetryRes.body)) {
        throw new Error(`Timed vs telemetry parity drift on ${def.workload_id}`);
      }

      const entry = {
        workload_id: def.workload_id,
        endpoint_or_task: def.endpoint_or_task,
        command: `node examples/sloppy-saas-api/benchmarks/run-benchmark.cjs --mode ${mode}`,
        response_status: telemetryRes.status,
        golden_sha256: canonicalJsonSha256(telemetryRes.body),
        queries_per_req: telemetryRes.queries,
        rows_scanned: telemetryRes.rowsScanned,
        internal_bytes_read: telemetryRes.internalBytes,
        payload_bytes: telemetryRes.payloadBytes,
        p50_ms: percentile(durations, 50),
        p95_ms: percentile(durations, 95),
        p99_ms: percentile(durations, 99),
        heap_delta_kb: heapDeltaKb,
        explain_plan_type: telemetryRes.plan,
      };

      const rowIdsHash = computeRowIdsHash(telemetryRes.body);
      if (rowIdsHash) {
        entry.row_ids_sha256 = rowIdsHash;
      }
      if (mode === "unslopped" && def.contract_projection_approved) {
        entry.contract_projection_approved = true;
      }

      workloads.push(entry);
    }

    return {
      schema_version: "1.0",
      run_id: `sloppy-saas-sqlite-${mode}`,
      phase: mode === "sloppy" ? "baseline" : "after",
      target_commit: "local-sqlite-fixture-v2",
      captured_at: new Date().toISOString(),
      cache_mode: "warm",
      dataset_rows: db.datasetRows,
      iterations,
      warmup_iterations: warmup,
      workloads,
    };
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await db.close();
  }
}

function parseArgs(argv) {
  const opts = { mode: "sloppy", out: null, iterations: 15, warmup: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--mode") opts.mode = argv[++i];
    else if (a === "--out") opts.out = argv[++i];
    else if (a === "--iterations") opts.iterations = Number.parseInt(argv[++i], 10);
    else if (a === "--warmup") opts.warmup = Number.parseInt(argv[++i], 10);
    else throw new Error(`Unknown flag: ${a}`);
  }
  if (opts.mode !== "sloppy" && opts.mode !== "unslopped") {
    throw new Error("--mode must be 'sloppy' or 'unslopped'");
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  runBenchmark(opts)
    .then((snapshot) => {
      const json = JSON.stringify(snapshot, null, 2);
      if (opts.out) {
        const outPath = path.resolve(opts.out);
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, `${json}\n`, "utf8");
        console.log(`Wrote ${opts.mode} real-SQLite snapshot -> ${outPath}`);
      } else {
        console.log(json);
      }
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}

module.exports = { runBenchmark };
