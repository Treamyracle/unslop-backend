"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const { promisify } = require("node:util");
const { DatabaseSync } = require("node:sqlite");

const gunzipAsync = promisify(zlib.gunzip);

const ORDER_STATUSES = ["paid", "paid", "paid", "pending", "refunded"];
const ORG_COUNT = 20;
const USERS_PER_ORG = 25;
const ORDERS_TOTAL = 5000;
const ITEMS_PER_ORDER = 3;

function createRng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function estimateBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    const sorted = {};
    for (const key of Object.keys(value).sort()) {
      sorted[key] = canonicalize(value[key]);
    }
    return sorted;
  }
  return value;
}

function canonicalJsonSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function buildEnrichmentShards(shardDir) {
  fs.mkdirSync(shardDir, { recursive: true });
  const specs = [
    { kind: "billing_tier", make: (i) => ({ plan: i % 3 === 0 ? "enterprise" : "scale_v2", discount_pct: 10 }) },
    { kind: "tax_rate", make: () => ({ jurisdiction: "US-CA", rate_bps: 825 }) },
    { kind: "shipping_sla", make: () => ({ tier: "priority_2d", cutoff_utc: "21:00" }) },
    { kind: "loyalty_score", make: () => ({ points: 4200, tier: "gold" }) },
  ];

  // Store each shard as a ~1.5 MB gzipped NDJSON lookup file so disk read + zlib.gunzip
  // runs across libuv's C++ worker threads instead of blocking the JS thread in JSON.parse.
  const pad = "v1_metadata_shard_entry_padding_".repeat(5);
  for (const spec of specs) {
    const lines = [];
    for (let i = 1; i <= 6000; i += 1) {
      const id = `ord-${String(i).padStart(5, "0")}`;
      lines.push(
        JSON.stringify({
          kind: spec.kind,
          key: id,
          ...spec.make(i),
          pad,
        })
      );
    }
    const gz = zlib.gzipSync(Buffer.from(lines.join("\n") + "\n", "utf8"), { level: 6 });
    fs.writeFileSync(path.join(shardDir, `${spec.kind}.ndjson.gz`), gz);
  }
}

function createEnrichmentServer(shardDir) {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const kind = url.searchParams.get("kind");
    const key = url.searchParams.get("key");
    if (!kind || !key || !/^[a-z_]+$/.test(kind)) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "Invalid enrichment query" }));
    }
    try {
      const gzBuf = await fs.promises.readFile(path.join(shardDir, `${kind}.ndjson.gz`));
      const rawBuf = await gunzipAsync(gzBuf);
      const needle = Buffer.from(`"key":"${key}"`, "utf8");
      const hitIdx = rawBuf.indexOf(needle);
      let item = { kind, key, ok: true };
      if (hitIdx !== -1) {
        const lineStart = rawBuf.lastIndexOf(10, hitIdx) + 1;
        const lineEnd = rawBuf.indexOf(10, hitIdx);
        const lineStr = rawBuf.toString("utf8", lineStart, lineEnd === -1 ? rawBuf.length : lineEnd);
        item = JSON.parse(lineStr);
      }
      const body = JSON.stringify({
        kind: item.kind,
        key: item.key,
        ...(item.plan ? { plan: item.plan, discount_pct: item.discount_pct } : {}),
        ...(item.jurisdiction ? { jurisdiction: item.jurisdiction, rate_bps: item.rate_bps } : {}),
        ...(item.tier && item.cutoff_utc ? { tier: item.tier, cutoff_utc: item.cutoff_utc } : {}),
        ...(item.points !== undefined ? { points: item.points, tier: item.tier } : {}),
      });
      res.writeHead(200, {
        "content-type": "application/json; charset=utf-8",
        "content-length": Buffer.byteLength(body, "utf8"),
      });
      res.end(body);
    } catch (err) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: err.message }));
    }
  });
}

function createRealSqliteDb(options = {}) {
  const seed = options.seed ?? 20261124;
  const withIndexes = Boolean(options.withIndexes);
  const forceFallbackStats = Boolean(options.forceFallbackStats);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unslop-saas-sqlite-"));
  const dbPath = path.join(tmpDir, "saas.sqlite");
  const shardDir = path.join(tmpDir, "enrichment-shards");

  const sqlite = new DatabaseSync(dbPath);
  sqlite.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE users (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      tier TEXT NOT NULL
    );

    CREATE TABLE orders (
      id TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL,
      total_cents INTEGER NOT NULL,
      currency TEXT NOT NULL,
      created_at TEXT NOT NULL,
      raw_webhook_payload TEXT NOT NULL,
      audit_trail TEXT NOT NULL
    );

    CREATE TABLE order_items (
      id TEXT PRIMARY KEY,
      order_id TEXT NOT NULL,
      sku TEXT NOT NULL,
      qty INTEGER NOT NULL,
      unit_cents INTEGER NOT NULL
    );
  `);

  const rng = createRng(seed);
  const baseTs = Date.UTC(2026, 9, 1, 0, 0, 0);
  const blobTemplate = "evt_stripe_payload_".repeat(105);
  const auditTemplate = "audit_step_verified_".repeat(50);

  sqlite.exec("BEGIN");
  try {
    const insertUser = sqlite.prepare(
      "INSERT INTO users (id, org_id, name, email, tier) VALUES (?, ?, ?, ?, ?)"
    );
    for (let o = 1; o <= ORG_COUNT; o += 1) {
      const orgId = `org-${o}`;
      for (let u = 1; u <= USERS_PER_ORG; u += 1) {
        const id = `usr-${o}-${u}`;
        insertUser.run(
          id,
          orgId,
          `User ${o}.${u}`,
          `user${u}@org${o}.example.test`,
          u % 5 === 0 ? "enterprise" : "pro"
        );
      }
    }

    const insertOrder = sqlite.prepare(
      "INSERT INTO orders (id, org_id, user_id, status, total_cents, currency, created_at, raw_webhook_payload, audit_trail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
    );
    const insertItem = sqlite.prepare(
      "INSERT INTO order_items (id, order_id, sku, qty, unit_cents) VALUES (?, ?, ?, ?, ?)"
    );

    for (let i = 1; i <= ORDERS_TOTAL; i += 1) {
      const orgNum = ((i - 1) % ORG_COUNT) + 1;
      const orgId = `org-${orgNum}`;
      const userNum = (Math.floor(rng() * USERS_PER_ORG) % USERS_PER_ORG) + 1;
      const userId = `usr-${orgNum}-${userNum}`;
      const status = ORDER_STATUSES[i % ORDER_STATUSES.length];
      const totalCents = 1500 + Math.floor(rng() * 25000);
      const createdAt = new Date(baseTs + i * 60000).toISOString();
      const orderId = `ord-${String(i).padStart(5, "0")}`;

      insertOrder.run(
        orderId,
        orgId,
        userId,
        status,
        totalCents,
        "USD",
        createdAt,
        `${orderId}:${blobTemplate}`,
        `${orderId}:${auditTemplate}`
      );

      for (let k = 1; k <= ITEMS_PER_ORDER; k += 1) {
        insertItem.run(
          `itm-${i}-${k}`,
          orderId,
          `SKU-${((i + k) % 40) + 100}`,
          (k % 3) + 1,
          Math.floor(totalCents / ITEMS_PER_ORDER)
        );
      }
    }
    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }

  function applyOptimizationIndexes() {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_orders_org_status_created
        ON orders (org_id, status, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_org_created
        ON orders (org_id, created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_orders_org_status_user_total
        ON orders (org_id, status, user_id, total_cents);
      CREATE INDEX IF NOT EXISTS idx_order_items_order_id
        ON order_items (order_id);
    `);
    sqlite.exec("ANALYZE;");
    explainCache.clear();
  }

  const tableCounts = {
    users: ORG_COUNT * USERS_PER_ORG,
    orders: ORDERS_TOTAL,
    order_items: ORDERS_TOTAL * ITEMS_PER_ORDER,
  };
  const explainCache = new Map();
  const stmtCache = new Map();

  if (withIndexes) {
    applyOptimizationIndexes();
  }

  buildEnrichmentShards(shardDir);
  const enrichmentServer = createEnrichmentServer(shardDir);
  let enrichmentBaseUrl = null;

  async function startEnrichmentServer() {
    if (enrichmentBaseUrl) return enrichmentBaseUrl;
    await new Promise((resolve) => enrichmentServer.listen(0, "127.0.0.1", resolve));
    const addr = enrichmentServer.address();
    enrichmentBaseUrl = `http://127.0.0.1:${addr.port}`;
    return enrichmentBaseUrl;
  }

  function getPlanDetails(sql) {
    if (explainCache.has(sql)) return explainCache.get(sql);
    const planRows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    const details = planRows.map((r) => String(r.detail || ""));
    explainCache.set(sql, details);
    return details;
  }

  function getStmt(sql) {
    if (stmtCache.has(sql)) return stmtCache.get(sql);
    const s = sqlite.prepare(sql);
    stmtCache.set(sql, s);
    return s;
  }

  function countIndexedAggregateRows(sql, params, rowsReturnedCount) {
    // Handles both top-level aggregates (SELECT COUNT/SUM FROM orders WHERE ...) and the top-5 subquery pattern
    const aggSubMatch = sql.match(/FROM\s*\(\s*SELECT[\s\S]+?\bFROM\s+(orders\s+WHERE[\s\S]+?)\bGROUP\s+BY\b/i);
    if (aggSubMatch) {
      const countSql = `SELECT COUNT(*) AS c FROM ${aggSubMatch[1].trim()}`;
      const qMarks = (countSql.match(/\?/g) || []).length;
      const cRow = sqlite.prepare(countSql).get(...params.slice(0, qMarks));
      return (cRow ? Number(cRow.c) : 0) + rowsReturnedCount;
    }
    const aggMatch = sql.match(/\bFROM\s+([\s\S]+?)(?=\b(?:GROUP\s+BY|ORDER\s+BY|LIMIT)\b|$)/i);
    if (aggMatch && /\b(?:COUNT|SUM|AVG|MIN|MAX)\s*\(/i.test(sql)) {
      const countSql = `SELECT COUNT(*) AS c FROM ${aggMatch[1].trim()}`;
      const qMarks = (countSql.match(/\?/g) || []).length;
      const cRow = sqlite.prepare(countSql).get(...params.slice(0, qMarks));
      return cRow ? Number(cRow.c) : rowsReturnedCount;
    }
    return null;
  }

  function recordPlanAndScan(tracker, sql, params, rowsReturnedCount, bytesRead, fsSteps) {
    tracker.queryCount += 1;
    tracker.internalBytesRead += bytesRead;
    if (typeof fsSteps === "number") {
      tracker.fullscanSteps += fsSteps;
    }
    const details = getPlanDetails(sql);
    let scanTables = 0;
    let searchNodes = 0;
    let scanFallback = 0;

    for (const detail of details) {
      if (/\b(?:CO-ROUTINE|SCAN agg)\b/.test(detail)) {
        tracker.plans.add(detail);
        continue;
      }
      tracker.plans.add(detail);
      const scanMatch = detail.match(/\bSCAN\s+([A-Za-z0-9_"]+)/);
      if (scanMatch) {
        const tbl = scanMatch[1].replace(/"/g, "");
        if (Object.prototype.hasOwnProperty.call(tableCounts, tbl)) {
          scanTables += 1;
          scanFallback += tableCounts[tbl];
        }
      } else if (/\bSEARCH\b/.test(detail)) {
        searchNodes += 1;
      }
    }

    let scannedHere = 0;
    if (typeof fsSteps === "number" && scanTables > 0) {
      const initRows = rowsReturnedCount > 0 || scanFallback > 0 ? scanTables : 0;
      scannedHere = fsSteps + initRows + searchNodes * rowsReturnedCount;
    } else if (scanTables > 0) {
      scannedHere = scanFallback + searchNodes * rowsReturnedCount;
    } else if (searchNodes > 0) {
      const aggCount = countIndexedAggregateRows(sql, params, rowsReturnedCount);
      scannedHere = aggCount !== null ? aggCount : Math.max(1, rowsReturnedCount);
    }

    tracker.rowsScanned += Math.max(rowsReturnedCount, scannedHere);
  }

  function queryAll(tracker, sql, params = []) {
    const stmt = getStmt(sql);
    if (!tracker) {
      return stmt.all(...params);
    }
    const useStat = !forceFallbackStats && typeof stmt.stat === "function";
    if (useStat) stmt.resetStats();
    const rows = stmt.all(...params);
    const fsSteps = useStat ? stmt.stat("fullscanStep") : null;
    recordPlanAndScan(tracker, sql, params, rows.length, estimateBytes(rows), fsSteps);
    return rows;
  }

  function queryGet(tracker, sql, params = []) {
    const stmt = getStmt(sql);
    if (!tracker) {
      return stmt.get(...params) || null;
    }
    const useStat = !forceFallbackStats && typeof stmt.stat === "function";
    if (useStat) stmt.resetStats();
    const row = stmt.get(...params) || null;
    const fsSteps = useStat ? stmt.stat("fullscanStep") : null;
    recordPlanAndScan(tracker, sql, params, row ? 1 : 0, row ? estimateBytes(row) : 0, fsSteps);
    return row;
  }

  function fetchEnrichmentLocal(tracker, kind, key) {
    if (!enrichmentBaseUrl) {
      throw new Error("Enrichment server not started; call await db.start() first");
    }
    if (tracker) {
      tracker.queryCount += 1;
      tracker.rowsScanned += 1;
      tracker.plans.add("LOCAL_HTTP_GUNZIP_SHARD");
    }
    return new Promise((resolve, reject) => {
      http
        .get(`${enrichmentBaseUrl}/lookup?kind=${encodeURIComponent(kind)}&key=${encodeURIComponent(key)}`, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () => {
            const buf = Buffer.concat(chunks);
            if (tracker) tracker.internalBytesRead += buf.length;
            try {
              resolve(JSON.parse(buf.toString("utf8")));
            } catch (err) {
              reject(err);
            }
          });
        })
        .on("error", reject);
    });
  }

  function newRequestTracker() {
    return {
      queryCount: 0,
      rowsScanned: 0,
      internalBytesRead: 0,
      fullscanSteps: 0,
      plans: new Set(),
    };
  }

  async function close() {
    if (enrichmentServer.listening) {
      await new Promise((resolve) => enrichmentServer.close(resolve));
      enrichmentBaseUrl = null;
    }
    stmtCache.clear();
    explainCache.clear();
    sqlite.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return {
    datasetRows: ORDERS_TOTAL,
    newRequestTracker,
    queryAll,
    queryGet,
    fetchEnrichmentLocal,
    applyOptimizationIndexes,
    start: startEnrichmentServer,
    close,
  };
}

module.exports = {
  createRealSqliteDb,
  canonicalJsonSha256,
};
