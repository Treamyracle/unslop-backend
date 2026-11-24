"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const { scanSourceText, scanTarget } = require("./scan-slop.cjs");

describe("scan-slop.cjs", () => {
  it("flags SELECT *, OFFSET, await-in-loop, sequential awaits, unbounded cache, and deep clone in loop", () => {
    const js = [
      "const requestCache = new Map();",
      "async function badHandler(db, orders) {",
      "  const sql = 'SELECT * FROM orders WHERE org_id = $1 OFFSET 200';",
      "  for (const o of orders) {",
      "    const user = await db.findUserById(o.userId);",
      "    const copy = JSON.parse(JSON.stringify(o));",
      "  }",
      "  const a = await fetch('https://a.test');",
      "  const b = await fetch('https://b.test');",
      "  const c = await fetch('https://c.test');",
      "  return { sql, a, b, c };",
      "}",
    ].join("\n");

    const leads = scanSourceText(js, "server.js", ".js");
    const rules = new Set(leads.map((l) => l.rule_id));

    assert.ok(rules.has("UNBOUNDED_IN_MEMORY_CACHE"));
    assert.ok(rules.has("SELECT_STAR"));
    assert.ok(rules.has("OFFSET_PAGINATION"));
    assert.ok(rules.has("AWAIT_IN_LOOP"));
    assert.ok(rules.has("DEEP_CLONE_IN_LOOP"));
    assert.ok(rules.has("SEQUENTIAL_AWAIT_WATERFALL"));
    assert.ok(leads.every((l) => l.candidate_only === true));
  });

  it("detects Python N+1 loop and Django objects.all() while ignoring comments and dependent awaits", () => {
    const py = [
      "# SELECT * FROM users -- comment only",
      "def load_all():",
      "    rows = Order.objects.all()",
      "    for order in rows:",
      "        user = session.get(User, order.user_id)",
      "    return rows",
    ].join("\n");

    const leads = scanSourceText(py, "views.py", ".py");
    const rules = new Set(leads.map((l) => l.rule_id));
    assert.ok(!rules.has("SELECT_STAR"), "commented SELECT * should be ignored");
    assert.ok(rules.has("UNPAGINATED_FIND_ALL"));
    assert.ok(rules.has("AWAIT_IN_LOOP"));
  });

  it("does not trigger sequential waterfall when awaits depend on previous variable", () => {
    const js = [
      "async function dependent(db, id) {",
      "  const order = await db.findOrder(id);",
      "  const user = await db.findUser(order.userId);",
      "  const plan = await db.findPlan(user.planId);",
      "  return plan;",
      "}",
    ].join("\n");

    const leads = scanSourceText(js, "dependent.js", ".js");
    assert.equal(
      leads.some((l) => l.rule_id === "SEQUENTIAL_AWAIT_WATERFALL"),
      false
    );
  });

  it("skips node_modules and executes cleanly as a CLI with --json", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unslop-scan-"));
    try {
      fs.mkdirSync(path.join(tmp, "node_modules", "pkg"), { recursive: true });
      fs.writeFileSync(
        path.join(tmp, "node_modules", "pkg", "bad.js"),
        "const q = 'SELECT * FROM secret';\n"
      );
      fs.writeFileSync(
        path.join(tmp, "clean.js"),
        "const q = 'SELECT id, status FROM orders WHERE org_id = $1';\n"
      );

      const res = scanTarget(tmp);
      assert.equal(res.scanned_files, 1);
      assert.equal(res.lead_count, 0);

      const stdout = execFileSync(
        process.execPath,
        [path.join(__dirname, "scan-slop.cjs"), tmp, "--json"],
        { encoding: "utf-8" }
      );
      const parsed = JSON.parse(stdout);
      assert.equal(parsed.candidate_only, true);
      assert.equal(parsed.scanned_files, 1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
