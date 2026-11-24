#!/usr/bin/env node
"use strict";

/**
 * Zero-dependency deterministic validator for workload-ledger.json.
 * Usage: node validate-workload-ledger.cjs [--repo-root <dir>] [--require-complete] [--json] [--help] <ledger.json>
 */

const fs = require("node:fs");
const path = require("node:path");
const { TextDecoder } = require("node:util");

const LIMITS = Object.freeze({
  inputBytes: 5 * 1024 * 1024,
  units: 10000,
  collectionItems: 500,
  nestingDepth: 64,
  validationErrors: 100,
  maxTextLength: 8192,
});

const SLOP_CLASSES = new Set([
  "n_plus_one_cascade",
  "missing_or_broken_index",
  "overfetch_and_payload_bloat",
  "in_app_aggregation",
  "async_waterfall",
  "connection_and_tx_bloat",
  "memory_and_stream_slop",
  "cold_start_and_bundle_slop",
]);

const SURFACE_TYPES = new Set([
  "http_route",
  "graphql_resolver",
  "rpc_handler",
  "orm_repository",
  "raw_sql",
  "migration_index",
  "background_job",
  "export_stream",
  "ai_pipeline",
  "serverless_entry",
]);

const LEDGER_STATUSES = new Set([
  "unassigned",
  "covered",
  "prior_covered_same_source",
  "out_of_scope",
]);

const REQUIRED_TOP_FIELDS = [
  "schema_version",
  "target_repo",
  "target_commit",
  "generated_at",
  "units",
];
const TOP_FIELD_SET = new Set(REQUIRED_TOP_FIELDS);

const REQUIRED_UNIT_FIELDS = [
  "unit_id",
  "file",
  "line_start",
  "line_end",
  "surface_type",
  "status",
  "checked_classes",
  "hunter_run_id",
];
const ALLOWED_UNIT_FIELDS = new Set([...REQUIRED_UNIT_FIELDS, "notes"]);

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;
const VISIBLE_CONTENT = /[^\p{White_Space}\p{Cc}\p{Cf}\p{Default_Ignorable_Code_Point}]/u;
const PATH_FORBIDDEN_CHAR = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/u;
const UNSAFE_DIAG_CHAR = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}\p{Default_Ignorable_Code_Point}]/gu;
const WINDOWS_RESERVED_COMPONENT = /^(?:con|prn|aux|nul|clock\$|conin\$|conout\$|com[1-9\u00b9\u00b2\u00b3]|lpt[1-9\u00b9\u00b2\u00b3])(?:\.|$)/iu;
const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

const hasOwn = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function escapeUnsafeDiagnosticCharacters(value) {
  return String(value).replace(UNSAFE_DIAG_CHAR, (ch) => {
    const cp = ch.codePointAt(0);
    return cp <= 0xffff
      ? `\\u${cp.toString(16).padStart(4, "0")}`
      : `\\u{${cp.toString(16)}}`;
  });
}

function safeQuote(value) {
  if (typeof value === "string") {
    const clipped = value.length > 256 ? `${value.slice(0, 256)}...` : value;
    return escapeUnsafeDiagnosticCharacters(JSON.stringify(clipped));
  }
  return escapeUnsafeDiagnosticCharacters(String(value));
}

function createErrorList() {
  const errors = [];
  Object.defineProperty(errors, "push", {
    value(...msgs) {
      const rem = LIMITS.validationErrors - this.length;
      if (rem > 0) {
        Array.prototype.push.apply(
          this,
          msgs.slice(0, rem).map(escapeUnsafeDiagnosticCharacters)
        );
      }
      return this.length;
    },
  });
  return errors;
}

function isNonEmptyString(value, maxLen = LIMITS.maxTextLength) {
  return (
    typeof value === "string" &&
    value.length <= maxLen &&
    VISIBLE_CONTENT.test(value)
  );
}

function checkMaxDepth(root, maxDepth) {
  const stack = [{ value: root, depth: 0 }];
  while (stack.length > 0) {
    const { value, depth } = stack.pop();
    if (depth > maxDepth) {
      return `JSON nesting depth exceeds limit (${maxDepth})`;
    }
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i += 1) {
        if (value[i] && typeof value[i] === "object") {
          stack.push({ value: value[i], depth: depth + 1 });
        }
      }
    } else if (isPlainObject(value)) {
      for (const k of Object.keys(value)) {
        if (value[k] && typeof value[k] === "object") {
          stack.push({ value: value[k], depth: depth + 1 });
        }
      }
    }
  }
  return null;
}

function readJsonStrict(filePath) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (err) {
    return { ok: false, error: `Cannot stat ${filePath}: ${err.message}` };
  }
  if (!stat.isFile()) {
    return { ok: false, error: `Target is not a regular file: ${filePath}` };
  }
  if (stat.size > LIMITS.inputBytes) {
    return {
      ok: false,
      error: `File exceeds ${LIMITS.inputBytes} byte limit (${stat.size} bytes): ${filePath}`,
    };
  }
  let buf;
  try {
    buf = fs.readFileSync(filePath);
  } catch (err) {
    return { ok: false, error: `Failed to read ${filePath}: ${err.message}` };
  }
  let text;
  try {
    text = UTF8_DECODER.decode(buf);
  } catch {
    return { ok: false, error: `Invalid UTF-8 encoding in ${filePath}` };
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch (err) {
    return { ok: false, error: `Invalid JSON in ${filePath}: ${err.message}` };
  }
  const depthErr = checkMaxDepth(data, LIMITS.nestingDepth);
  if (depthErr) {
    return { ok: false, error: depthErr };
  }
  return { ok: true, data };
}

function validateSafeRepoRelativePath(rawPath, repoRoot) {
  if (typeof rawPath !== "string" || !VISIBLE_CONTENT.test(rawPath)) {
    return { ok: false, error: "file path must be a non-empty string" };
  }
  if (rawPath.length > 512) {
    return { ok: false, error: `file path exceeds 512 chars: ${safeQuote(rawPath)}` };
  }
  if (PATH_FORBIDDEN_CHAR.test(rawPath)) {
    return { ok: false, error: `file path contains forbidden characters: ${safeQuote(rawPath)}` };
  }
  if (/^[A-Za-z]:/.test(rawPath) || rawPath.startsWith("/") || rawPath.startsWith("\\")) {
    return { ok: false, error: `file path must be repository-relative, got ${safeQuote(rawPath)}` };
  }
  const normalized = rawPath.replace(/\\/g, "/");
  const segments = normalized.split("/");
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      return { ok: false, error: `unsafe path segment in ${safeQuote(rawPath)}` };
    }
    if (WINDOWS_RESERVED_COMPONENT.test(seg)) {
      return { ok: false, error: `Windows reserved component in ${safeQuote(rawPath)}` };
    }
  }

  if (!repoRoot) {
    return { ok: true, resolved: null, normalized };
  }

  let realRoot;
  try {
    realRoot = fs.realpathSync(repoRoot);
  } catch (err) {
    return { ok: false, error: `Invalid --repo-root ${safeQuote(repoRoot)}: ${err.message}` };
  }
  const joined = path.resolve(realRoot, ...segments);
  let realTarget;
  try {
    realTarget = fs.realpathSync(joined);
  } catch {
    return { ok: false, error: `Referenced file does not exist under repo-root: ${normalized}` };
  }
  const rel = path.relative(realRoot, realTarget);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return { ok: false, error: `Path escapes repo-root via symlink: ${normalized}` };
  }
  try {
    if (!fs.statSync(realTarget).isFile()) {
      return { ok: false, error: `Referenced path is not a file: ${normalized}` };
    }
  } catch (err) {
    return { ok: false, error: `Cannot stat referenced file ${normalized}: ${err.message}` };
  }
  return { ok: true, resolved: realTarget, normalized };
}

function countFileLines(filePath, cache) {
  if (cache && cache.has(filePath)) {
    return cache.get(filePath);
  }
  const text = fs.readFileSync(filePath, "utf-8");
  const lines = text.length === 0 ? 0 : text.split(/\r\n|\r|\n/).length;
  if (cache) cache.set(filePath, lines);
  return lines;
}

function validateWorkloadLedgerData(data, options = {}) {
  const errors = createErrorList();
  const repoRoot = options.repoRoot || null;
  const requireComplete = Boolean(options.requireComplete);
  const lineCache = new Map();

  if (!isPlainObject(data)) {
    errors.push("Workload ledger root must be a JSON object");
    return { ok: false, errors, summary: null };
  }

  for (const field of REQUIRED_TOP_FIELDS) {
    if (!hasOwn(data, field)) {
      errors.push(`Missing required root field: ${field}`);
    }
  }
  for (const key of Object.keys(data)) {
    if (!TOP_FIELD_SET.has(key)) {
      errors.push(`Unexpected root field: ${safeQuote(key)}`);
    }
  }

  if (hasOwn(data, "schema_version") && data.schema_version !== "1.0") {
    errors.push(`schema_version must be "1.0", got ${safeQuote(data.schema_version)}`);
  }
  for (const strKey of ["target_repo", "target_commit", "generated_at"]) {
    if (hasOwn(data, strKey) && !isNonEmptyString(data[strKey], 512)) {
      errors.push(`${strKey} must be a non-empty string`);
    }
  }

  if (!Array.isArray(data.units) || data.units.length === 0) {
    errors.push("units must be a non-empty array");
    return { ok: false, errors, summary: null };
  }
  if (data.units.length > LIMITS.units) {
    errors.push(`units exceeds limit of ${LIMITS.units}`);
  }

  const seenIds = new Set();
  let coveredCount = 0;
  let unassignedCount = 0;
  let outOfScopeCount = 0;

  for (let idx = 0; idx < data.units.length; idx += 1) {
    const unit = data.units[idx];
    const prefix = `units[${idx}]`;
    if (!isPlainObject(unit)) {
      errors.push(`${prefix} must be an object`);
      continue;
    }

    for (const reqField of REQUIRED_UNIT_FIELDS) {
      if (!hasOwn(unit, reqField)) {
        errors.push(`${prefix} missing required field: ${reqField}`);
      }
    }
    for (const k of Object.keys(unit)) {
      if (!ALLOWED_UNIT_FIELDS.has(k)) {
        errors.push(`${prefix} has unexpected field: ${safeQuote(k)}`);
      }
    }

    if (hasOwn(unit, "unit_id")) {
      if (typeof unit.unit_id !== "string" || !ID_PATTERN.test(unit.unit_id)) {
        errors.push(`${prefix}.unit_id has invalid format: ${safeQuote(unit.unit_id)}`);
      } else if (seenIds.has(unit.unit_id)) {
        errors.push(`Duplicate unit_id: ${safeQuote(unit.unit_id)}`);
      } else {
        seenIds.add(unit.unit_id);
      }
    }

    if (hasOwn(unit, "surface_type") && !SURFACE_TYPES.has(unit.surface_type)) {
      errors.push(`${prefix}.surface_type invalid: ${safeQuote(unit.surface_type)}`);
    }

    if (hasOwn(unit, "status") && !LEDGER_STATUSES.has(unit.status)) {
      errors.push(`${prefix}.status invalid: ${safeQuote(unit.status)}`);
    }

    if (hasOwn(unit, "line_start") && (!Number.isInteger(unit.line_start) || unit.line_start < 1)) {
      errors.push(`${prefix}.line_start must be an integer >= 1`);
    }
    if (hasOwn(unit, "line_end") && (!Number.isInteger(unit.line_end) || unit.line_end < 1)) {
      errors.push(`${prefix}.line_end must be an integer >= 1`);
    }
    if (
      Number.isInteger(unit.line_start) &&
      Number.isInteger(unit.line_end) &&
      unit.line_end < unit.line_start
    ) {
      errors.push(`${prefix}.line_end (${unit.line_end}) < line_start (${unit.line_start})`);
    }

    if (hasOwn(unit, "file")) {
      const pathCheck = validateSafeRepoRelativePath(unit.file, repoRoot);
      if (!pathCheck.ok) {
        errors.push(`${prefix}.file: ${pathCheck.error}`);
      } else if (pathCheck.resolved && Number.isInteger(unit.line_end)) {
        const totalLines = countFileLines(pathCheck.resolved, lineCache);
        if (unit.line_end > totalLines) {
          errors.push(
            `${prefix}: line_end ${unit.line_end} exceeds ${pathCheck.normalized} line count (${totalLines})`
          );
        }
      }
    }

    if (hasOwn(unit, "checked_classes")) {
      if (!Array.isArray(unit.checked_classes)) {
        errors.push(`${prefix}.checked_classes must be an array`);
      } else {
        const seenClasses = new Set();
        for (const cls of unit.checked_classes) {
          if (!SLOP_CLASSES.has(cls)) {
            errors.push(`${prefix}.checked_classes contains unknown class: ${safeQuote(cls)}`);
          } else if (seenClasses.has(cls)) {
            errors.push(`${prefix}.checked_classes contains duplicate class: ${safeQuote(cls)}`);
          } else {
            seenClasses.add(cls);
          }
        }
      }
    }

    if (hasOwn(unit, "hunter_run_id") && typeof unit.hunter_run_id !== "string") {
      errors.push(`${prefix}.hunter_run_id must be a string`);
    }
    if (hasOwn(unit, "notes") && typeof unit.notes !== "string") {
      errors.push(`${prefix}.notes must be a string`);
    }

    if (unit.status === "covered" || unit.status === "prior_covered_same_source") {
      coveredCount += 1;
      if (!Array.isArray(unit.checked_classes) || unit.checked_classes.length === 0) {
        errors.push(`${prefix} (${unit.status}) must list >= 1 class in checked_classes`);
      }
      if (!isNonEmptyString(unit.hunter_run_id, 128)) {
        errors.push(`${prefix} (${unit.status}) must specify a non-empty hunter_run_id`);
      }
    } else if (unit.status === "unassigned") {
      unassignedCount += 1;
    } else if (unit.status === "out_of_scope") {
      outOfScopeCount += 1;
      if (!isNonEmptyString(unit.notes, 1024)) {
        errors.push(`${prefix} (out_of_scope) must explain why in notes`);
      }
    }
  }

  const inScopeCount = data.units.length - outOfScopeCount;
  const coveragePct =
    inScopeCount === 0 ? 100 : Number(((coveredCount / inScopeCount) * 100).toFixed(2));

  if (requireComplete && unassignedCount > 0) {
    errors.push(
      `--require-complete failed: ${unassignedCount} in-scope unit(s) remain unassigned (${coveragePct}% covered)`
    );
  }

  const summary = {
    total_units: data.units.length,
    in_scope_units: inScopeCount,
    covered_units: coveredCount,
    unassigned_units: unassignedCount,
    out_of_scope_units: outOfScopeCount,
    coverage_pct: coveragePct,
  };

  return { ok: errors.length === 0, errors, summary };
}

function validateWorkloadLedgerFile(filePath, options = {}) {
  const parsed = readJsonStrict(filePath);
  if (!parsed.ok) {
    return { ok: false, errors: [parsed.error], summary: null, data: null };
  }
  const result = validateWorkloadLedgerData(parsed.data, options);
  return { ...result, data: parsed.data };
}

function parseArgs(argv) {
  const opts = { repoRoot: null, requireComplete: false, json: false, help: false, file: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
    } else if (arg === "--require-complete") {
      opts.requireComplete = true;
    } else if (arg === "--json") {
      opts.json = true;
    } else if (arg === "--repo-root") {
      if (i + 1 >= argv.length) throw new Error("--repo-root requires a directory path");
      opts.repoRoot = argv[++i];
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!opts.file) {
      opts.file = arg;
    } else {
      throw new Error(`Unexpected extra positional argument: ${arg}`);
    }
  }
  return opts;
}

function printHelp() {
  console.log(
    [
      "Usage: node validate-workload-ledger.cjs [options] <workload-ledger.json>",
      "",
      "Options:",
      "  --repo-root <dir>     Verify file paths and line bounds against repository files",
      "  --require-complete    Fail if any in-scope unit remains unassigned",
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

  const res = validateWorkloadLedgerFile(path.resolve(opts.file), {
    repoRoot: opts.repoRoot ? path.resolve(opts.repoRoot) : null,
    requireComplete: opts.requireComplete,
  });

  if (opts.json) {
    console.log(JSON.stringify({ ok: res.ok, summary: res.summary, errors: res.errors }, null, 2));
  } else if (res.ok) {
    const s = res.summary;
    console.log(
      `Workload ledger VALID: ${s.covered_units}/${s.in_scope_units} in-scope units covered (${s.coverage_pct}%), ${s.out_of_scope_units} out_of_scope.`
    );
  } else {
    console.error(`Workload ledger INVALID (${res.errors.length} error(s)):`);
    for (const err of res.errors) console.error(`  - ${err}`);
  }
  process.exit(res.ok ? 0 : 1);
}

module.exports = {
  LIMITS,
  SLOP_CLASSES,
  SURFACE_TYPES,
  LEDGER_STATUSES,
  ID_PATTERN,
  hasOwn,
  isPlainObject,
  isNonEmptyString,
  safeQuote,
  createErrorList,
  escapeUnsafeDiagnosticCharacters,
  readJsonStrict,
  validateSafeRepoRelativePath,
  countFileLines,
  validateWorkloadLedgerData,
  validateWorkloadLedgerFile,
};
