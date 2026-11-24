#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency paired benchmark + golden SHA-256 comparator.
 * Hard-fails on golden drift, cache_mode/dataset_rows mismatch, or gains below noise floor.
 *
 * Usage:
 *   node compare-benchmarks.cjs [options] <baseline.json> <after.json>
 */

const path = require("node:path");
const {
  ID_PATTERN,
  hasOwn,
  isPlainObject,
  isNonEmptyString,
  safeQuote,
  createErrorList,
  readJsonStrict,
} = require("./validate-workload-ledger.cjs");

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const CACHE_MODES = new Set(["cold", "warm"]);
const PHASES = new Set(["baseline", "after"]);

const REQUIRED_ROOT_FIELDS = [
  "schema_version",
  "run_id",
  "phase",
  "target_commit",
  "captured_at",
  "cache_mode",
  "dataset_rows",
  "iterations",
  "warmup_iterations",
  "workloads",
];
const ROOT_FIELD_SET = new Set(REQUIRED_ROOT_FIELDS);

const REQUIRED_WORKLOAD_FIELDS = [
  "workload_id",
  "endpoint_or_task",
  "command",
  "response_status",
  "golden_sha256",
  "queries_per_req",
  "rows_scanned",
  "payload_bytes",
  "p50_ms",
  "p95_ms",
  "p99_ms",
  "heap_delta_kb",
  "explain_plan_type",
];
const ALLOWED_WORKLOAD_FIELDS = new Set([
  ...REQUIRED_WORKLOAD_FIELDS,
  "row_ids_sha256",
  "contract_projection_approved",
  "internal_bytes_read",
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  minQueryDrop: 0.5,
  minScanDrop: 0.5,
  minPayloadDrop: 0.3,
  minLatencyDrop: 0.2,
  minHeapDrop: 0.3,
  maxRegression: 0.15,
});

function isNonNegativeFinite(v) {
  return typeof v === "number" && Number.isFinite(v) && v >= 0;
}

function validateBenchmarkData(data, expectedPhase = null) {
  const errors = createErrorList();

  if (!isPlainObject(data)) {
    errors.push("Benchmark snapshot root must be a JSON object");
    return { ok: false, errors };
  }

  for (const field of REQUIRED_ROOT_FIELDS) {
    if (!hasOwn(data, field)) errors.push(`Missing required benchmark field: ${field}`);
  }
  for (const key of Object.keys(data)) {
    if (!ROOT_FIELD_SET.has(key)) errors.push(`Unexpected benchmark root field: ${safeQuote(key)}`);
  }

  if (hasOwn(data, "schema_version") && data.schema_version !== "1.0") {
    errors.push(`schema_version must be "1.0", got ${safeQuote(data.schema_version)}`);
  }
  for (const k of ["run_id", "target_commit", "captured_at"]) {
    if (hasOwn(data, k) && !isNonEmptyString(data[k], 512)) {
      errors.push(`${k} must be a non-empty string`);
    }
  }
  if (hasOwn(data, "phase")) {
    if (!PHASES.has(data.phase)) {
      errors.push(`phase must be "baseline" or "after", got ${safeQuote(data.phase)}`);
    } else if (expectedPhase && data.phase !== expectedPhase) {
      errors.push(`Expected phase "${expectedPhase}", got ${safeQuote(data.phase)}`);
    }
  }
  if (hasOwn(data, "cache_mode") && !CACHE_MODES.has(data.cache_mode)) {
    errors.push(`cache_mode must be "cold" or "warm", got ${safeQuote(data.cache_mode)}`);
  }
  if (hasOwn(data, "dataset_rows") && (!Number.isInteger(data.dataset_rows) || data.dataset_rows < 1)) {
    errors.push("dataset_rows must be an integer >= 1");
  }
  if (hasOwn(data, "iterations") && (!Number.isInteger(data.iterations) || data.iterations < 1)) {
    errors.push("iterations must be an integer >= 1");
  }
  if (
    hasOwn(data, "warmup_iterations") &&
    (!Number.isInteger(data.warmup_iterations) || data.warmup_iterations < 0)
  ) {
    errors.push("warmup_iterations must be an integer >= 0");
  }

  if (!Array.isArray(data.workloads) || data.workloads.length === 0) {
    errors.push("workloads must be a non-empty array");
    return { ok: false, errors };
  }

  const seen = new Set();
  for (let i = 0; i < data.workloads.length; i += 1) {
    const w = data.workloads[i];
    const p = `workloads[${i}]`;
    if (!isPlainObject(w)) {
      errors.push(`${p} must be an object`);
      continue;
    }
    for (const f of REQUIRED_WORKLOAD_FIELDS) {
      if (!hasOwn(w, f)) errors.push(`${p} missing required field: ${f}`);
    }
    for (const k of Object.keys(w)) {
      if (!ALLOWED_WORKLOAD_FIELDS.has(k)) errors.push(`${p} unexpected field: ${safeQuote(k)}`);
    }
    if (hasOwn(w, "workload_id")) {
      if (typeof w.workload_id !== "string" || !ID_PATTERN.test(w.workload_id)) {
        errors.push(`${p}.workload_id invalid: ${safeQuote(w.workload_id)}`);
      } else if (seen.has(w.workload_id)) {
        errors.push(`Duplicate workload_id: ${safeQuote(w.workload_id)}`);
      } else {
        seen.add(w.workload_id);
      }
    }
    for (const sField of ["endpoint_or_task", "command", "explain_plan_type"]) {
      if (hasOwn(w, sField) && !isNonEmptyString(w[sField], 1024)) {
        errors.push(`${p}.${sField} must be a non-empty string`);
      }
    }
    if (
      hasOwn(w, "response_status") &&
      (!Number.isInteger(w.response_status) || w.response_status < 100 || w.response_status > 599)
    ) {
      errors.push(`${p}.response_status must be an HTTP status integer 100..599`);
    }
    if (
      hasOwn(w, "golden_sha256") &&
      (typeof w.golden_sha256 !== "string" || !SHA256_PATTERN.test(w.golden_sha256))
    ) {
      errors.push(`${p}.golden_sha256 must be a 64-char lowercase hex SHA-256`);
    }
    if (
      hasOwn(w, "row_ids_sha256") &&
      (typeof w.row_ids_sha256 !== "string" || !SHA256_PATTERN.test(w.row_ids_sha256))
    ) {
      errors.push(`${p}.row_ids_sha256 must be a 64-char lowercase hex SHA-256`);
    }
    if (
      hasOwn(w, "contract_projection_approved") &&
      typeof w.contract_projection_approved !== "boolean"
    ) {
      errors.push(`${p}.contract_projection_approved must be a boolean`);
    }
    for (const numField of [
      "queries_per_req",
      "rows_scanned",
      "payload_bytes",
      "p50_ms",
      "p95_ms",
      "p99_ms",
    ]) {
      if (hasOwn(w, numField) && !isNonNegativeFinite(w[numField])) {
        errors.push(`${p}.${numField} must be a finite number >= 0`);
      }
    }
    if (hasOwn(w, "internal_bytes_read") && !isNonNegativeFinite(w.internal_bytes_read)) {
      errors.push(`${p}.internal_bytes_read must be a finite number >= 0`);
    }
    if (
      hasOwn(w, "heap_delta_kb") &&
      (typeof w.heap_delta_kb !== "number" || !Number.isFinite(w.heap_delta_kb))
    ) {
      errors.push(`${p}.heap_delta_kb must be a finite number`);
    }
  }

  return { ok: errors.length === 0, errors };
}

function validateBenchmarkFile(filePath, expectedPhase = null) {
  const parsed = readJsonStrict(filePath);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], data: null };
  const val = validateBenchmarkData(parsed.data, expectedPhase);
  return { ...val, data: parsed.data };
}

function pctDrop(before, after) {
  if (typeof before !== "number" || typeof after !== "number" || before <= 0) return 0;
  return Number(((before - after) / before).toFixed(4));
}

function compareWorkloads(baseW, afterW, userThresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...userThresholds };
  const reasons = [];

  if (baseW.response_status !== afterW.response_status) {
    reasons.push(
      `response_status drifted (${baseW.response_status} -> ${afterW.response_status})`
    );
  }

  let goldenMatch = false;
  let goldenMode = "exact_sha256";
  if (afterW.contract_projection_approved === true) {
    goldenMode = "row_ids_projection";
    if (!baseW.row_ids_sha256 || !afterW.row_ids_sha256) {
      reasons.push(
        "contract_projection_approved=true requires row_ids_sha256 in both baseline and after"
      );
    } else if (baseW.row_ids_sha256 !== afterW.row_ids_sha256) {
      reasons.push(
        `row_ids_sha256 DRIFT (${baseW.row_ids_sha256.slice(0, 12)} vs ${afterW.row_ids_sha256.slice(0, 12)})`
      );
    } else {
      goldenMatch = true;
    }
  } else if (baseW.golden_sha256 !== afterW.golden_sha256) {
    reasons.push(
      `golden_sha256 DRIFT (${baseW.golden_sha256.slice(0, 12)} vs ${afterW.golden_sha256.slice(0, 12)})`
    );
  } else {
    goldenMatch = true;
  }

  const deltas = {
    queries_drop: pctDrop(baseW.queries_per_req, afterW.queries_per_req),
    rows_scanned_drop: pctDrop(baseW.rows_scanned, afterW.rows_scanned),
    payload_bytes_drop: pctDrop(baseW.payload_bytes, afterW.payload_bytes),
    internal_bytes_drop:
      hasOwn(baseW, "internal_bytes_read") && hasOwn(afterW, "internal_bytes_read")
        ? pctDrop(baseW.internal_bytes_read, afterW.internal_bytes_read)
        : null,
    p95_ms_drop: pctDrop(baseW.p95_ms, afterW.p95_ms),
    heap_delta_drop:
      baseW.heap_delta_kb > 0 ? pctDrop(baseW.heap_delta_kb, afterW.heap_delta_kb) : null,
  };

  const wins = [];
  if (baseW.queries_per_req >= 2 && deltas.queries_drop >= t.minQueryDrop) {
    wins.push(`queries -${(deltas.queries_drop * 100).toFixed(1)}%`);
  }
  if (baseW.rows_scanned >= 50 && deltas.rows_scanned_drop >= t.minScanDrop) {
    wins.push(`rows_scanned -${(deltas.rows_scanned_drop * 100).toFixed(1)}%`);
  }
  if (
    deltas.internal_bytes_drop !== null &&
    baseW.internal_bytes_read >= 256 &&
    deltas.internal_bytes_drop >= t.minPayloadDrop
  ) {
    wins.push(`internal_bytes -${(deltas.internal_bytes_drop * 100).toFixed(1)}%`);
  }
  if (baseW.payload_bytes >= 256 && deltas.payload_bytes_drop >= t.minPayloadDrop) {
    wins.push(`payload_bytes -${(deltas.payload_bytes_drop * 100).toFixed(1)}%`);
  }
  if (baseW.p95_ms >= 2 && deltas.p95_ms_drop >= t.minLatencyDrop) {
    wins.push(`p95_ms -${(deltas.p95_ms_drop * 100).toFixed(1)}%`);
  }
  if (
    deltas.heap_delta_drop !== null &&
    baseW.heap_delta_kb >= 64 &&
    deltas.heap_delta_drop >= t.minHeapDrop
  ) {
    wins.push(`heap_kb -${(deltas.heap_delta_drop * 100).toFixed(1)}%`);
  }

  if (wins.length === 0) {
    reasons.push("No primary telemetry metric cleared the minimum improvement noise floor");
  }

  const regressions = [];
  const checkCountRegression = (label, bVal, aVal, absMin = 1) => {
    if (
      typeof bVal === "number" &&
      typeof aVal === "number" &&
      bVal > 0 &&
      aVal - bVal > absMin &&
      (aVal - bVal) / bVal > t.maxRegression
    ) {
      regressions.push(`${label} regressed (${bVal} -> ${aVal})`);
    }
  };
  checkCountRegression("queries_per_req", baseW.queries_per_req, afterW.queries_per_req, 0);
  checkCountRegression("rows_scanned", baseW.rows_scanned, afterW.rows_scanned, 5);
  checkCountRegression("payload_bytes", baseW.payload_bytes, afterW.payload_bytes, 64);
  if (hasOwn(baseW, "internal_bytes_read") && hasOwn(afterW, "internal_bytes_read")) {
    checkCountRegression("internal_bytes_read", baseW.internal_bytes_read, afterW.internal_bytes_read, 128);
  }
  for (const reg of regressions) reasons.push(reg);

  return {
    workload_id: baseW.workload_id,
    endpoint_or_task: baseW.endpoint_or_task,
    ok: reasons.length === 0,
    golden_match: goldenMatch,
    golden_mode: goldenMode,
    baseline: baseW,
    after: afterW,
    deltas,
    wins,
    reasons,
  };
}

function compareBenchmarks(baseline, after, userThresholds = {}) {
  const errors = createErrorList();
  const baseCheck = validateBenchmarkData(baseline, null);
  const afterCheck = validateBenchmarkData(after, null);
  if (!baseCheck.ok) {
    for (const e of baseCheck.errors) errors.push(`baseline: ${e}`);
  }
  if (!afterCheck.ok) {
    for (const e of afterCheck.errors) errors.push(`after: ${e}`);
  }
  if (errors.length > 0) {
    return { ok: false, errors, comparisons: [] };
  }

  if (baseline.cache_mode !== after.cache_mode) {
    errors.push(
      `Unfair benchmark: cache_mode mismatch (baseline=${baseline.cache_mode} vs after=${after.cache_mode})`
    );
  }
  if (baseline.dataset_rows !== after.dataset_rows) {
    errors.push(
      `Unfair benchmark: dataset_rows mismatch (baseline=${baseline.dataset_rows} vs after=${after.dataset_rows})`
    );
  }

  const baseMap = new Map(baseline.workloads.map((w) => [w.workload_id, w]));
  const afterMap = new Map(after.workloads.map((w) => [w.workload_id, w]));

  for (const id of baseMap.keys()) {
    if (!afterMap.has(id)) errors.push(`Workload ${safeQuote(id)} missing from after snapshot`);
  }
  for (const id of afterMap.keys()) {
    if (!baseMap.has(id)) errors.push(`Workload ${safeQuote(id)} missing from baseline snapshot`);
  }

  const comparisons = [];
  if (errors.length === 0) {
    for (const [id, baseW] of baseMap.entries()) {
      const cmp = compareWorkloads(baseW, afterMap.get(id), userThresholds);
      comparisons.push(cmp);
      if (!cmp.ok) {
        for (const r of cmp.reasons) errors.push(`${id}: ${r}`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    meta: {
      cache_mode: baseline.cache_mode,
      dataset_rows: baseline.dataset_rows,
      baseline_run_id: baseline.run_id,
      after_run_id: after.run_id,
    },
    comparisons,
  };
}

function fmtPct(drop) {
  if (drop === null || drop === undefined) return "—";
  const pct = (drop * 100).toFixed(1);
  return drop >= 0 ? `-${pct}%` : `+${Math.abs(Number(pct)).toFixed(1)}%`;
}

function formatComparisonMarkdown(result) {
  if (!result.comparisons || result.comparisons.length === 0) {
    return result.errors.map((e) => `- ERROR: ${e}`).join("\n");
  }
  const lines = [
    `Paired Benchmark Gate: **${result.ok ? "PASS" : "FAIL"}** (\`cache_mode=${result.meta.cache_mode}\`, \`dataset_rows=${result.meta.dataset_rows}\`)`,
    "",
    "| Workload | Queries (Before → After) | Rows Scanned | Internal / Payload Bytes | p95 Latency | Golden Parity | Gate |",
    "|---|---:|---:|---:|---:|---|---|",
  ];
  for (const c of result.comparisons) {
    const b = c.baseline;
    const a = c.after;
    const qStr = `${b.queries_per_req} → ${a.queries_per_req} (${fmtPct(c.deltas.queries_drop)})`;
    const rStr = `${b.rows_scanned} → ${a.rows_scanned} (${fmtPct(c.deltas.rows_scanned_drop)})`;
    const bytesBefore =
      hasOwn(b, "internal_bytes_read") && b.internal_bytes_read > b.payload_bytes
        ? `${b.internal_bytes_read}B int`
        : `${b.payload_bytes}B`;
    const bytesAfter =
      hasOwn(a, "internal_bytes_read") && hasOwn(b, "internal_bytes_read") && b.internal_bytes_read > b.payload_bytes
        ? `${a.internal_bytes_read}B int (${fmtPct(c.deltas.internal_bytes_drop)})`
        : `${a.payload_bytes}B (${fmtPct(c.deltas.payload_bytes_drop)})`;
    const lStr = `${b.p95_ms.toFixed(2)}ms → ${a.p95_ms.toFixed(2)}ms (${fmtPct(c.deltas.p95_ms_drop)})`;
    const gStr = c.golden_match
      ? c.golden_mode === "row_ids_projection"
        ? "MATCH (row IDs)"
        : "MATCH (SHA-256)"
      : "DRIFT";
    const statusStr = c.ok ? "PASS" : `FAIL: ${c.reasons.join("; ")}`;
    lines.push(
      `| \`${c.workload_id}\` | ${qStr} | ${rStr} | ${bytesBefore} → ${bytesAfter} | ${lStr} | ${gStr} | ${statusStr} |`
    );
  }
  if (!result.ok) {
    lines.push("", "Errors:");
    for (const err of result.errors) lines.push(`- ${err}`);
  }
  return lines.join("\n");
}

function parseArgs(argv) {
  const opts = { json: false, help: false, thresholds: {}, files: [] };
  const numFlag = (idx, name) => {
    if (idx + 1 >= argv.length) throw new Error(`${name} requires a number`);
    const v = Number(argv[idx + 1]);
    if (!Number.isFinite(v) || v < 0 || v > 1) {
      throw new Error(`${name} must be a ratio in [0, 1]`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--min-query-drop") {
      opts.thresholds.minQueryDrop = numFlag(i, arg);
      i += 1;
    } else if (arg === "--min-scan-drop") {
      opts.thresholds.minScanDrop = numFlag(i, arg);
      i += 1;
    } else if (arg === "--min-payload-drop") {
      opts.thresholds.minPayloadDrop = numFlag(i, arg);
      i += 1;
    } else if (arg === "--min-latency-drop") {
      opts.thresholds.minLatencyDrop = numFlag(i, arg);
      i += 1;
    } else if (arg === "--min-heap-drop") {
      opts.thresholds.minHeapDrop = numFlag(i, arg);
      i += 1;
    } else if (arg === "--max-regression") {
      opts.thresholds.maxRegression = numFlag(i, arg);
      i += 1;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      opts.files.push(arg);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: node compare-benchmarks.cjs [options] <baseline.json> <after.json>",
      "",
      "Options:",
      "  --min-query-drop <ratio>    Minimum relative drop in queries_per_req (default 0.50)",
      "  --min-scan-drop <ratio>     Minimum relative drop in rows_scanned (default 0.50)",
      "  --min-payload-drop <ratio>  Minimum relative drop in bytes read/sent (default 0.30)",
      "  --min-latency-drop <ratio>  Minimum relative drop in p95_ms (default 0.20)",
      "  --min-heap-drop <ratio>     Minimum relative drop in heap_delta_kb (default 0.30)",
      "  --max-regression <ratio>    Max allowed count/byte regression (default 0.15)",
      "  --json                      Emit structured JSON output",
      "  --help, -h                  Show this help message",
    ].join("\n")
  );
}

if (require.main === module) {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
  if (opts.help) {
    printHelp();
    process.exit(0);
  }
  if (opts.files.length !== 2) {
    printHelp();
    process.exit(1);
  }

  const baseRes = validateBenchmarkFile(path.resolve(opts.files[0]), null);
  const afterRes = validateBenchmarkFile(path.resolve(opts.files[1]), null);
  let result;
  if (!baseRes.ok || !afterRes.ok) {
    const errors = [
      ...baseRes.errors.map((e) => `baseline: ${e}`),
      ...afterRes.errors.map((e) => `after: ${e}`),
    ];
    result = { ok: false, errors, comparisons: [] };
  } else {
    result = compareBenchmarks(baseRes.data, afterRes.data, opts.thresholds);
  }

  if (opts.json) {
    console.log(JSON.stringify(result, null, 2));
  } else if (result.ok) {
    console.log(formatComparisonMarkdown(result));
  } else {
    console.error(formatComparisonMarkdown(result));
  }
  process.exit(result.ok ? 0 : 1);
}

module.exports = {
  SHA256_PATTERN,
  DEFAULT_THRESHOLDS,
  validateBenchmarkData,
  validateBenchmarkFile,
  compareWorkloads,
  compareBenchmarks,
  formatComparisonMarkdown,
};
