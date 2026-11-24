"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  validateWorkloadLedgerData,
  validateSafeRepoRelativePath,
} = require("./validate-workload-ledger.cjs");

function makeTmpRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "unslop-ledger-"));
  fs.writeFileSync(path.join(dir, "server.js"), "line1\nline2\nline3\nline4\nline5\n");
  return dir;
}

function validLedger() {
  return {
    schema_version: "1.0",
    target_repo: "example/app",
    target_commit: "abc1234",
    generated_at: "2026-11-24T00:00:00Z",
    units: [
      {
        unit_id: "orders-route",
        file: "server.js",
        line_start: 1,
        line_end: 5,
        surface_type: "http_route",
        status: "covered",
        checked_classes: ["n_plus_one_cascade", "missing_or_broken_index"],
        hunter_run_id: "hunter-1",
      },
    ],
  };
}

describe("validate-workload-ledger.cjs", () => {
  it("accepts a valid covered ledger within repo line bounds", () => {
    const repo = makeTmpRepo();
    try {
      const res = validateWorkloadLedgerData(validLedger(), {
        repoRoot: repo,
        requireComplete: true,
      });
      assert.equal(res.ok, true);
      assert.equal(res.summary.coverage_pct, 100);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects out-of-bounds line_end and path traversal attempts", () => {
    const repo = makeTmpRepo();
    try {
      const bad = validLedger();
      bad.units[0].line_end = 999;
      const r1 = validateWorkloadLedgerData(bad, { repoRoot: repo });
      assert.equal(r1.ok, false);
      assert.match(r1.errors[0], /exceeds server\.js line count/);

      const trav = validateSafeRepoRelativePath("../etc/passwd", repo);
      assert.equal(trav.ok, false);
      assert.match(trav.error, /unsafe path segment/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("fails closed on --require-complete when an in-scope unit is unassigned", () => {
    const repo = makeTmpRepo();
    try {
      const ledger = validLedger();
      ledger.units.push({
        unit_id: "dashboard-route",
        file: "server.js",
        line_start: 2,
        line_end: 4,
        surface_type: "http_route",
        status: "unassigned",
        checked_classes: [],
        hunter_run_id: "",
      });

      const rPermissive = validateWorkloadLedgerData(ledger, { repoRoot: repo });
      assert.equal(rPermissive.ok, true);
      assert.equal(rPermissive.summary.coverage_pct, 50);

      const rStrict = validateWorkloadLedgerData(ledger, {
        repoRoot: repo,
        requireComplete: true,
      });
      assert.equal(rStrict.ok, false);
      assert.match(rStrict.errors[0], /remain unassigned/);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });

  it("rejects duplicate unit_ids and covered units missing checked_classes or hunter_run_id", () => {
    const dup = validLedger();
    dup.units.push({ ...dup.units[0] });
    const rDup = validateWorkloadLedgerData(dup);
    assert.equal(rDup.ok, false);
    assert.ok(rDup.errors.some((e) => /Duplicate unit_id/.test(e)));

    const hollow = validLedger();
    hollow.units[0].checked_classes = [];
    hollow.units[0].hunter_run_id = "";
    const rHollow = validateWorkloadLedgerData(hollow);
    assert.equal(rHollow.ok, false);
    assert.ok(rHollow.errors.some((e) => /checked_classes/.test(e)));
    assert.ok(rHollow.errors.some((e) => /hunter_run_id/.test(e)));
  });

  it("runs cleanly via CLI --json", () => {
    const repo = makeTmpRepo();
    const ledgerPath = path.join(repo, "ledger.json");
    try {
      fs.writeFileSync(ledgerPath, JSON.stringify(validLedger()));
      const out = execFileSync(
        process.execPath,
        [
          path.join(__dirname, "validate-workload-ledger.cjs"),
          "--repo-root",
          repo,
          "--require-complete",
          "--json",
          ledgerPath,
        ],
        { encoding: "utf-8" }
      );
      const parsed = JSON.parse(out);
      assert.equal(parsed.ok, true);
    } finally {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  });
});
