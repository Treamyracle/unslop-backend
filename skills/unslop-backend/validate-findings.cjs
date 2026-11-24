#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency deterministic validator for findings.json.
 * Cross-checks source line citations, workload-ledger coverage, and paired benchmark parity.
 *
 * Usage:
 *   node validate-findings.cjs [--repo-root <dir>] [--ledger <workload-ledger.json>] [--baseline <baseline.json>] [--after <after.json>] [--json] [--help] <findings.json>
 */

const path = require("node:path");
const {
  SLOP_CLASSES,
  ID_PATTERN,
  hasOwn,
  isPlainObject,
  isNonEmptyString,
  safeQuote,
  createErrorList,
  readJsonStrict,
  validateSafeRepoRelativePath,
  countFileLines,
  validateWorkloadLedgerFile,
} = require("./validate-workload-ledger.cjs");
const { validateBenchmarkFile, compareWorkloads } = require("./compare-benchmarks.cjs");

const MODES = new Set(["audit", "unslop"]);
const VERDICTS = new Set(["fixed", "confirmed", "needs_validation", "rejected"]);
const SEVERITIES = new Set(["critical", "high", "medium", "low"]);
const TRACE_ROLES = new Set([
  "entrypoint",
  "query_or_io",
  "aggregation",
  "fix_site",
  "guard_or_index",
]);

const REQUIRED_ROOT_FIELDS = [
  "schema_version",
  "mode",
  "target_repo",
  "target_commit",
  "generated_at",
  "findings",
];
const ROOT_FIELD_SET = new Set(REQUIRED_ROOT_FIELDS);

const BASE_FINDING_FIELDS = [
  "finding_id",
  "unit_id",
  "slop_class",
  "verdict",
  "severity",
  "title",
  "summary",
  "source_trace",
  "skeptic_attempted",
  "skeptic_notes",
];

const CONFIRMED_FIELDS = new Set([
  ...BASE_FINDING_FIELDS,
  "workload_id",
  "benchmark_command",
  "baseline_metrics",
  "remediation",
]);

const FIXED_FIELDS = new Set([
  ...BASE_FINDING_FIELDS,
  "workload_id",
  "benchmark_command",
  "baseline_metrics",
  "after_metrics",
  "golden_match",
  "improvement_summary",
  "regression_guard_test",
]);

const NEEDS_VALIDATION_FIELDS = new Set([
  ...BASE_FINDING_FIELDS,
  "unresolved_fact",
  "safe_verification_recipe",
]);

const REJECTED_FIELDS = new Set([
  ...BASE_FINDING_FIELDS,
  "rejection_reason",
  "mitigating_evidence",
]);

const TRACE_FIELD_SET = new Set(["file", "line_start", "line_end", "symbol", "role"]);

function validateSourceTrace(trace, prefix, repoRoot, lineCache, errors, minHops) {
  if (!Array.isArray(trace) || trace.length < minHops) {
    errors.push(`${prefix}.source_trace must contain >= ${minHops} hop(s)`);
    return;
  }
  for (let i = 0; i < trace.length; i += 1) {
    const hop = trace[i];
    const hp = `${prefix}.source_trace[${i}]`;
    if (!isPlainObject(hop)) {
      errors.push(`${hp} must be an object`);
      continue;
    }
    for (const f of TRACE_FIELD_SET) {
      if (!hasOwn(hop, f)) errors.push(`${hp} missing field: ${f}`);
    }
    for (const k of Object.keys(hop)) {
      if (!TRACE_FIELD_SET.has(k)) errors.push(`${hp} unexpected field: ${safeQuote(k)}`);
    }
    if (hasOwn(hop, "symbol") && !isNonEmptyString(hop.symbol, 256)) {
      errors.push(`${hp}.symbol must be a non-empty string`);
    }
    if (hasOwn(hop, "role") && !TRACE_ROLES.has(hop.role)) {
      errors.push(`${hp}.role invalid: ${safeQuote(hop.role)}`);
    }
    if (hasOwn(hop, "line_start") && (!Number.isInteger(hop.line_start) || hop.line_start < 1)) {
      errors.push(`${hp}.line_start must be an integer >= 1`);
    }
    if (hasOwn(hop, "line_end") && (!Number.isInteger(hop.line_end) || hop.line_end < 1)) {
      errors.push(`${hp}.line_end must be an integer >= 1`);
    }
    if (
      Number.isInteger(hop.line_start) &&
      Number.isInteger(hop.line_end) &&
      hop.line_end < hop.line_start
    ) {
      errors.push(`${hp}.line_end (${hop.line_end}) < line_start (${hop.line_start})`);
    }
    if (hasOwn(hop, "file")) {
      const pathCheck = validateSafeRepoRelativePath(hop.file, repoRoot);
      if (!pathCheck.ok) {
        errors.push(`${hp}.file: ${pathCheck.error}`);
      } else if (pathCheck.resolved && Number.isInteger(hop.line_end)) {
        const totalLines = countFileLines(pathCheck.resolved, lineCache);
        if (hop.line_end > totalLines) {
          errors.push(
            `${hp}: line_end ${hop.line_end} exceeds ${pathCheck.normalized} line count (${totalLines})`
          );
        }
      }
    }
  }
}

function validateMetricsObject(obj, label, errors) {
  if (!isPlainObject(obj) || Object.keys(obj).length === 0) {
    errors.push(`${label} must be a non-empty object of measured numeric telemetry`);
    return;
  }
  let numericCount = 0;
  for (const [k, v] of Object.entries(obj)) {
    if (typeof v === "number") {
      if (!Number.isFinite(v)) errors.push(`${label}.${k} must be finite`);
      else numericCount += 1;
    }
  }
  if (numericCount === 0) {
    errors.push(`${label} must include at least one finite numeric measurement`);
  }
}

function validateFindingsData(data, options = {}) {
  const errors = createErrorList();
  const repoRoot = options.repoRoot || null;
  const ledger = options.ledger || null;
  const baseline = options.baseline || null;
  const after = options.after || null;
  const lineCache = new Map();

  if (!isPlainObject(data)) {
    errors.push("findings root must be a JSON object");
    return { ok: false, errors, summary: null };
  }

  for (const field of REQUIRED_ROOT_FIELDS) {
    if (!hasOwn(data, field)) errors.push(`Missing required root field: ${field}`);
  }
  for (const k of Object.keys(data)) {
    if (!ROOT_FIELD_SET.has(k)) errors.push(`Unexpected root field: ${safeQuote(k)}`);
  }

  if (hasOwn(data, "schema_version") && data.schema_version !== "1.0") {
    errors.push(`schema_version must be "1.0", got ${safeQuote(data.schema_version)}`);
  }
  if (hasOwn(data, "mode") && !MODES.has(data.mode)) {
    errors.push(`mode must be "audit" or "unslop", got ${safeQuote(data.mode)}`);
  }
  for (const k of ["target_repo", "target_commit", "generated_at"]) {
    if (hasOwn(data, k) && !isNonEmptyString(data[k], 512)) {
      errors.push(`${k} must be a non-empty string`);
    }
  }
  if (!Array.isArray(data.findings)) {
    errors.push("findings must be an array");
    return { ok: false, errors, summary: null };
  }

  const ledgerIds = ledger ? new Set(ledger.units.map((u) => u.unit_id)) : null;
  const baseWorkloads = baseline
    ? new Map(baseline.workloads.map((w) => [w.workload_id, w]))
    : null;
  const afterWorkloads = after
    ? new Map(after.workloads.map((w) => [w.workload_id, w]))
    : null;

  const seenFindingIds = new Set();
  const counts = { fixed: 0, confirmed: 0, needs_validation: 0, rejected: 0 };

  for (let i = 0; i < data.findings.length; i += 1) {
    const f = data.findings[i];
    const p = `findings[${i}]`;
    if (!isPlainObject(f)) {
      errors.push(`${p} must be an object`);
      continue;
    }

    for (const reqField of BASE_FINDING_FIELDS) {
      if (!hasOwn(f, reqField)) errors.push(`${p} missing required field: ${reqField}`);
    }

    if (hasOwn(f, "finding_id")) {
      if (typeof f.finding_id !== "string" || !ID_PATTERN.test(f.finding_id)) {
        errors.push(`${p}.finding_id invalid: ${safeQuote(f.finding_id)}`);
      } else if (seenFindingIds.has(f.finding_id)) {
        errors.push(`Duplicate finding_id: ${safeQuote(f.finding_id)}`);
      } else {
        seenFindingIds.add(f.finding_id);
      }
    }

    if (hasOwn(f, "unit_id")) {
      if (typeof f.unit_id !== "string" || !ID_PATTERN.test(f.unit_id)) {
        errors.push(`${p}.unit_id invalid: ${safeQuote(f.unit_id)}`);
      } else if (ledgerIds && !ledgerIds.has(f.unit_id)) {
        errors.push(`${p}.unit_id ${safeQuote(f.unit_id)} not found in workload-ledger.json`);
      }
    }

    if (hasOwn(f, "slop_class") && !SLOP_CLASSES.has(f.slop_class)) {
      errors.push(`${p}.slop_class invalid: ${safeQuote(f.slop_class)}`);
    }

    for (const sField of ["title", "summary", "skeptic_notes"]) {
      if (hasOwn(f, sField) && !isNonEmptyString(f[sField])) {
        errors.push(`${p}.${sField} must be a non-empty string`);
      }
    }

    if (hasOwn(f, "skeptic_attempted") && typeof f.skeptic_attempted !== "boolean") {
      errors.push(`${p}.skeptic_attempted must be a boolean`);
    }

    if (!hasOwn(f, "verdict") || !VERDICTS.has(f.verdict)) {
      errors.push(`${p}.verdict invalid: ${safeQuote(f.verdict)}`);
      continue;
    }

    counts[f.verdict] += 1;

    if (f.verdict === "fixed" && data.mode === "audit") {
      errors.push(`${p}: verdict "fixed" is not allowed in read-only "audit" mode`);
    }

    const minHops = f.verdict === "fixed" || f.verdict === "confirmed" ? 2 : 1;
    validateSourceTrace(f.source_trace, p, repoRoot, lineCache, errors, minHops);

    let allowedSet;
    if (f.verdict === "confirmed") allowedSet = CONFIRMED_FIELDS;
    else if (f.verdict === "fixed") allowedSet = FIXED_FIELDS;
    else if (f.verdict === "needs_validation") allowedSet = NEEDS_VALIDATION_FIELDS;
    else allowedSet = REJECTED_FIELDS;

    for (const reqKey of allowedSet) {
      if (!hasOwn(f, reqKey)) errors.push(`${p} (${f.verdict}) missing required field: ${reqKey}`);
    }
    for (const key of Object.keys(f)) {
      if (!allowedSet.has(key)) {
        errors.push(`${p} (${f.verdict}) has disallowed field: ${safeQuote(key)}`);
      }
    }

    if (f.verdict === "confirmed" || f.verdict === "fixed") {
      if (!SEVERITIES.has(f.severity)) {
        errors.push(`${p} (${f.verdict}) severity must be critical|high|medium|low`);
      }
      if (f.skeptic_attempted !== true) {
        errors.push(`${p} (${f.verdict}) requires skeptic_attempted: true`);
      }
      if (hasOwn(f, "workload_id") && !isNonEmptyString(f.workload_id, 128)) {
        errors.push(`${p}.workload_id must be a non-empty string`);
      }
      if (hasOwn(f, "benchmark_command") && !isNonEmptyString(f.benchmark_command, 1024)) {
        errors.push(`${p}.benchmark_command must be a non-empty string`);
      }
      validateMetricsObject(f.baseline_metrics, `${p}.baseline_metrics`, errors);

      if (baseWorkloads && isNonEmptyString(f.workload_id, 128) && !baseWorkloads.has(f.workload_id)) {
        errors.push(`${p}.workload_id ${safeQuote(f.workload_id)} not found in baseline.json`);
      }

      if (f.verdict === "confirmed") {
        if (hasOwn(f, "remediation") && !isNonEmptyString(f.remediation)) {
          errors.push(`${p}.remediation must be a non-empty string`);
        }
      } else {
        validateMetricsObject(f.after_metrics, `${p}.after_metrics`, errors);
        if (f.golden_match !== true) {
          errors.push(`${p} (fixed) requires golden_match: true`);
        }
        if (hasOwn(f, "improvement_summary") && !isNonEmptyString(f.improvement_summary)) {
          errors.push(`${p}.improvement_summary must be a non-empty string`);
        }
        if (hasOwn(f, "regression_guard_test") && !isNonEmptyString(f.regression_guard_test, 512)) {
          errors.push(`${p}.regression_guard_test must be a non-empty string`);
        }
        if (afterWorkloads && isNonEmptyString(f.workload_id, 128)) {
          if (!afterWorkloads.has(f.workload_id)) {
            errors.push(`${p}.workload_id ${safeQuote(f.workload_id)} not found in after.json`);
          } else if (baseWorkloads && baseWorkloads.has(f.workload_id)) {
            const cmp = compareWorkloads(
              baseWorkloads.get(f.workload_id),
              afterWorkloads.get(f.workload_id)
            );
            if (!cmp.ok) {
              errors.push(
                `${p} failed cross-check against baseline/after benchmark: ${cmp.reasons.join("; ")}`
              );
            }
          }
        }
      }
    } else if (f.verdict === "needs_validation") {
      if (f.severity !== null) {
        errors.push(`${p} (needs_validation) must have severity: null`);
      }
      if (!isNonEmptyString(f.unresolved_fact)) {
        errors.push(`${p}.unresolved_fact must be a non-empty string`);
      }
      if (!isNonEmptyString(f.safe_verification_recipe)) {
        errors.push(`${p}.safe_verification_recipe must be a non-empty string`);
      }
    } else if (f.verdict === "rejected") {
      if (f.severity !== null) {
        errors.push(`${p} (rejected) must have severity: null`);
      }
      if (!isNonEmptyString(f.rejection_reason)) {
        errors.push(`${p}.rejection_reason must be a non-empty string`);
      }
      if (!isNonEmptyString(f.mitigating_evidence)) {
        errors.push(`${p}.mitigating_evidence must be a non-empty string`);
      }
    }
  }

  return {
    ok: errors.length === 0,
    errors,
    summary: {
      mode: data.mode,
      total_findings: data.findings.length,
      ...counts,
    },
  };
}

function validateFindingsFile(filePath, options = {}) {
  const parsed = readJsonStrict(filePath);
  if (!parsed.ok) return { ok: false, errors: [parsed.error], summary: null, data: null };

  const resolvedOpts = {
    repoRoot: options.repoRoot || null,
    ledger: options.ledger || null,
    baseline: options.baseline || null,
    after: options.after || null,
  };

  if (options.ledgerPath) {
    const lRes = validateWorkloadLedgerFile(options.ledgerPath, {
      repoRoot: resolvedOpts.repoRoot,
    });
    if (!lRes.ok) {
      return {
        ok: false,
        errors: lRes.errors.map((e) => `ledger: ${e}`),
        summary: null,
        data: parsed.data,
      };
    }
    resolvedOpts.ledger = lRes.data;
  }

  if (options.baselinePath) {
    const bRes = validateBenchmarkFile(options.baselinePath, null);
    if (!bRes.ok) {
      return {
        ok: false,
        errors: bRes.errors.map((e) => `baseline: ${e}`),
        summary: null,
        data: parsed.data,
      };
    }
    resolvedOpts.baseline = bRes.data;
  }

  if (options.afterPath) {
    const aRes = validateBenchmarkFile(options.afterPath, null);
    if (!aRes.ok) {
      return {
        ok: false,
        errors: aRes.errors.map((e) => `after: ${e}`),
        summary: null,
        data: parsed.data,
      };
    }
    resolvedOpts.after = aRes.data;
  }

  const res = validateFindingsData(parsed.data, resolvedOpts);
  return { ...res, data: parsed.data };
}

function parseArgs(argv) {
  const opts = {
    repoRoot: null,
    ledgerPath: null,
    baselinePath: null,
    afterPath: null,
    json: false,
    help: false,
    file: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") opts.help = true;
    else if (arg === "--json") opts.json = true;
    else if (arg === "--repo-root") {
      if (i + 1 >= argv.length) throw new Error("--repo-root requires a path");
      opts.repoRoot = argv[++i];
    } else if (arg === "--ledger") {
      if (i + 1 >= argv.length) throw new Error("--ledger requires a path");
      opts.ledgerPath = argv[++i];
    } else if (arg === "--baseline") {
      if (i + 1 >= argv.length) throw new Error("--baseline requires a path");
      opts.baselinePath = argv[++i];
    } else if (arg === "--after") {
      if (i + 1 >= argv.length) throw new Error("--after requires a path");
      opts.afterPath = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!opts.file) {
      opts.file = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: node validate-findings.cjs [options] <findings.json>",
      "",
      "Options:",
      "  --repo-root <dir>     Verify all source_trace files and line numbers exist",
      "  --ledger <file>       Cross-check every unit_id against workload-ledger.json",
      "  --baseline <file>     Cross-check workload_id against baseline.json",
      "  --after <file>        Cross-check fixed findings against after.json + golden parity",
      "  --json                Emit machine-readable JSON output",
      "  --help, -h            Show this help message",
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
  if (!opts.file) {
    printHelp();
    process.exit(1);
  }

  const res = validateFindingsFile(path.resolve(opts.file), {
    repoRoot: opts.repoRoot ? path.resolve(opts.repoRoot) : null,
    ledgerPath: opts.ledgerPath ? path.resolve(opts.ledgerPath) : null,
    baselinePath: opts.baselinePath ? path.resolve(opts.baselinePath) : null,
    afterPath: opts.afterPath ? path.resolve(opts.afterPath) : null,
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: res.ok, summary: res.summary, errors: res.errors }, null, 2));
  } else if (res.ok) {
    const s = res.summary;
    console.log(
      `Findings VALID (${s.mode} mode): ${s.fixed} fixed, ${s.confirmed} confirmed, ${s.needs_validation} needs_validation, ${s.rejected} rejected.`
    );
  } else {
    console.error(`Findings INVALID (${res.errors.length} error(s)):`);
    for (const err of res.errors) console.error(`  - ${err}`);
  }
  process.exit(res.ok ? 0 : 1);
}

module.exports = {
  MODES,
  VERDICTS,
  SEVERITIES,
  TRACE_ROLES,
  validateFindingsData,
  validateFindingsFile,
};
