#!/usr/bin/env node
"use strict";

/**
 * Reproducible real-world SQLite benchmark reproducing triple-layer N+1 cascades
 * and unindexed FK table scans found in louislam/uptime-kuma (commit 1cc2fa7b1c).
 *
 * Usage:
 *   node examples/case-studies/uptime-kuma/reproduce.cjs [--out-baseline <path>] [--out-after <path>] [--iterations 15] [--warmup 3]
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const UPSTREAM_COMMIT = "1cc2fa7b1c9ec2be8e610167c8208309283177f2";
const STATUS_DOWN = 0;
const STATUS_UP = 1;

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonicalize(value[k]);
    return out;
  }
  return value;
}

function canonicalJsonSha256(value) {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify(canonicalize(value)), "utf8")
    .digest("hex");
}

function estimateBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function percentile(sortedNums, p) {
  if (sortedNums.length === 0) return 0;
  const idx = Math.min(
    sortedNums.length - 1,
    Math.max(0, Math.ceil((p / 100) * sortedNums.length) - 1)
  );
  return Number(sortedNums[idx].toFixed(3));
}

function createUptimeKumaSqliteFixture({ withFixIndexes = false, forceFallbackStats = false } = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "unslop-uptime-kuma-"));
  const dbPath = path.join(tmpDir, "kuma.db");
  const sqlite = new DatabaseSync(dbPath);

  // Exact schema + indexes from louislam/uptime-kuma db/knex_init_db.js (@ 1cc2fa7b1c)
  sqlite.exec(`
    PRAGMA journal_mode = DELETE;
    PRAGMA synchronous = NORMAL;

    CREATE TABLE status_page (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      slug TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL,
      description TEXT,
      icon TEXT NOT NULL,
      theme TEXT NOT NULL,
      published INTEGER NOT NULL DEFAULT 1,
      show_tags INTEGER NOT NULL DEFAULT 1,
      show_certificate_expiry INTEGER NOT NULL DEFAULT 1,
      show_only_last_heartbeat INTEGER NOT NULL DEFAULT 0,
      custom_css TEXT,
      footer_text TEXT,
      show_powered_by INTEGER NOT NULL DEFAULT 1,
      analytics_id TEXT,
      analytics_script_url TEXT,
      analytics_type TEXT,
      rss_title TEXT
    );

    CREATE TABLE "group" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      public INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      weight INTEGER NOT NULL DEFAULT 1000,
      status_page_id INTEGER
    );

    CREATE TABLE monitor (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      user_id INTEGER,
      interval INTEGER NOT NULL DEFAULT 20,
      url TEXT,
      type TEXT,
      weight INTEGER DEFAULT 2000,
      hostname TEXT,
      port INTEGER,
      keyword TEXT,
      description TEXT,
      headers TEXT,
      body TEXT,
      database_connection_string TEXT,
      database_query TEXT,
      grpc_protobuf TEXT
    );

    CREATE TABLE monitor_group (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      group_id INTEGER NOT NULL,
      weight INTEGER NOT NULL DEFAULT 1000,
      send_url INTEGER NOT NULL DEFAULT 0,
      custom_url TEXT
    );
    -- Upstream index has monitor_id FIRST, so WHERE group_id = ? cannot use leading key!
    CREATE INDEX fk ON monitor_group (monitor_id, group_id);

    CREATE TABLE tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      color TEXT NOT NULL
    );

    -- Upstream db/knex_init_db.js defines NO index on monitor_tag(monitor_id)
    CREATE TABLE monitor_tag (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      tag_id INTEGER NOT NULL,
      value TEXT
    );

    -- Upstream db/knex_init_db.js defines NO index on monitor_tls_info(monitor_id)
    CREATE TABLE monitor_tls_info (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      monitor_id INTEGER NOT NULL,
      info_json TEXT
    );

    CREATE TABLE heartbeat (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      important INTEGER NOT NULL DEFAULT 0,
      monitor_id INTEGER NOT NULL,
      status INTEGER NOT NULL,
      msg TEXT,
      time TEXT NOT NULL,
      ping INTEGER
    );
    CREATE INDEX monitor_time_index ON heartbeat (monitor_id, time);
    CREATE INDEX heartbeat_monitor_id ON heartbeat (monitor_id);

    CREATE TABLE incident (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      content TEXT NOT NULL,
      style TEXT NOT NULL DEFAULT 'warning',
      created_date TEXT NOT NULL,
      last_updated_date TEXT,
      pin INTEGER NOT NULL DEFAULT 1,
      active INTEGER NOT NULL DEFAULT 1,
      status_page_id INTEGER
    );

    CREATE TABLE maintenance_status_page (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      status_page_id INTEGER NOT NULL,
      maintenance_id INTEGER NOT NULL
    );
  `);

  const STATUS_PAGES = 10;
  const GROUPS_PER_PAGE = 10; // 100 groups total; 10 on prod-status
  const MONITORS_TOTAL = 1000; // 100 monitors mapped onto prod-status (10 per group)
  const TAGS_TOTAL = 12;
  const HEARTBEATS_PER_MONITOR = 25; // 25,000 heartbeats total

  const bigHeaders = JSON.stringify({
    "user-agent": "Uptime-Kuma-Probe/2.0",
    "x-telemetry-trace": "kuma_header_pad_".repeat(40),
  });
  const bigBody = JSON.stringify({ healthcheck: true, payload: "kuma_body_".repeat(90) });
  const bigTlsJsonBase = (mId) =>
    JSON.stringify({
      valid: true,
      certInfo: {
        daysRemaining: 42 + (mId % 30),
        issuer: "Let's Encrypt E6",
        pemChain: "CERT_CHAIN_".repeat(120),
      },
    });

  sqlite.exec("BEGIN");
  try {
    const insPage = sqlite.prepare(
      "INSERT INTO status_page (slug, title, description, icon, theme, published, show_tags, show_certificate_expiry) VALUES (?, ?, ?, ?, ?, 1, 1, 1)"
    );
    for (let p = 1; p <= STATUS_PAGES; p += 1) {
      insPage.run(
        p === 1 ? "prod-status" : `status-${p}`,
        `Service Status ${p}`,
        "Public service health dashboard",
        "/icon.svg",
        "auto"
      );
    }

    const insGroup = sqlite.prepare(
      'INSERT INTO "group" (name, public, active, weight, status_page_id) VALUES (?, 1, 1, ?, ?)'
    );
    for (let p = 1; p <= STATUS_PAGES; p += 1) {
      for (let g = 1; g <= GROUPS_PER_PAGE; g += 1) {
        insGroup.run(`Region Group ${p}.${g}`, g * 10, p);
      }
    }

    const insTag = sqlite.prepare("INSERT INTO tag (name, color) VALUES (?, ?)");
    for (let t = 1; t <= TAGS_TOTAL; t += 1) {
      insTag.run(`tag-${String(t).padStart(2, "0")}`, "#10B981");
    }

    const insMonitor = sqlite.prepare(
      "INSERT INTO monitor (name, active, url, type, weight, headers, body, description) VALUES (?, 1, ?, ?, ?, ?, ?, ?)"
    );
    const insMonTag = sqlite.prepare(
      "INSERT INTO monitor_tag (monitor_id, tag_id, value) VALUES (?, ?, ?)"
    );
    const insTls = sqlite.prepare(
      "INSERT INTO monitor_tls_info (monitor_id, info_json) VALUES (?, ?)"
    );
    const insHb = sqlite.prepare(
      "INSERT INTO heartbeat (important, monitor_id, status, msg, time, ping) VALUES (0, ?, ?, ?, ?, ?)"
    );

    const baseTs = Date.UTC(2026, 10, 1, 0, 0, 0);
    for (let m = 1; m <= MONITORS_TOTAL; m += 1) {
      insMonitor.run(
        `API Probe ${m}`,
        `https://service-${m}.example.test/health`,
        "http",
        m,
        bigHeaders,
        bigBody,
        `Monitor description ${m}`
      );
      for (let k = 0; k < 3; k += 1) {
        const tagId = ((m + k) % TAGS_TOTAL) + 1;
        insMonTag.run(m, tagId, `v${k}`);
      }
      insTls.run(m, bigTlsJsonBase(m));

      for (let h = 1; h <= HEARTBEATS_PER_MONITOR; h += 1) {
        const isLast = h === HEARTBEATS_PER_MONITOR;
        const st = isLast && m % 5 === 0 ? STATUS_DOWN : STATUS_UP;
        const ts = new Date(baseTs + (m * 100 + h) * 1000).toISOString();
        insHb.run(m, st, st === STATUS_UP ? "200 OK" : "503 Timeout", ts, 18 + (h % 20));
      }
    }

    const insMonGroup = sqlite.prepare(
      "INSERT INTO monitor_group (monitor_id, group_id, weight, send_url, custom_url) VALUES (?, ?, ?, 1, NULL)"
    );
    for (let g = 1; g <= STATUS_PAGES * GROUPS_PER_PAGE; g += 1) {
      for (let slot = 1; slot <= 10; slot += 1) {
        const mId = (g - 1) * 10 + slot;
        insMonGroup.run(mId, g, slot * 10);
      }
    }

    const insInc = sqlite.prepare(
      "INSERT INTO incident (title, content, style, created_date, pin, active, status_page_id) VALUES (?, ?, 'warning', ?, 1, 1, ?)"
    );
    for (let i = 1; i <= 3; i += 1) {
      insInc.run(
        `Elevated latency notice #${i}`,
        "Investigating upstream edge routing.",
        new Date(baseTs + i * 3600000).toISOString(),
        1
      );
    }

    sqlite.exec("COMMIT");
  } catch (err) {
    sqlite.exec("ROLLBACK");
    throw err;
  }

  if (withFixIndexes) {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_group_status_page_public_weight
        ON "group" (status_page_id, public, weight);
      CREATE INDEX IF NOT EXISTS idx_monitor_group_group_weight
        ON monitor_group (group_id, weight);
      CREATE INDEX IF NOT EXISTS idx_monitor_tag_monitor
        ON monitor_tag (monitor_id, tag_id);
      CREATE INDEX IF NOT EXISTS idx_monitor_tls_info_monitor
        ON monitor_tls_info (monitor_id);
      CREATE INDEX IF NOT EXISTS idx_incident_status_pin_active
        ON incident (status_page_id, pin, active, created_date DESC);
      CREATE INDEX IF NOT EXISTS idx_maintenance_sp
        ON maintenance_status_page (status_page_id, maintenance_id);
      ANALYZE;
    `);
  }

  const tableCounts = {
    status_page: STATUS_PAGES,
    group: STATUS_PAGES * GROUPS_PER_PAGE,
    monitor: MONITORS_TOTAL,
    monitor_group: MONITORS_TOTAL,
    tag: TAGS_TOTAL,
    monitor_tag: MONITORS_TOTAL * 3,
    monitor_tls_info: MONITORS_TOTAL,
    heartbeat: MONITORS_TOTAL * HEARTBEATS_PER_MONITOR,
    incident: 3,
    maintenance_status_page: 0,
  };

  const stmtCache = new Map();
  const explainCache = new Map();

  function getStmt(sql) {
    if (stmtCache.has(sql)) return stmtCache.get(sql);
    const s = sqlite.prepare(sql);
    stmtCache.set(sql, s);
    return s;
  }

  function getPlanDetails(sql) {
    if (explainCache.has(sql)) return explainCache.get(sql);
    const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
    const details = rows.map((r) => String(r.detail || ""));
    explainCache.set(sql, details);
    return details;
  }

  function track(tracker, sql, rowsArr, returnedCount, bytesRead, fsSteps, isSingleGet) {
    tracker.queryCount += 1;
    tracker.internalBytesRead += bytesRead;
    if (typeof fsSteps === "number") {
      tracker.fullscanSteps += fsSteps;
    }

    const details = getPlanDetails(sql);
    let scanTables = 0;
    let searchNodes = 0;
    let scanRowsFallback = 0;

    for (const detail of details) {
      // Ignore SQLite internal CTE/constant-row bookkeeping from synthetic VALUES lists
      if (/\b(?:CO-ROUTINE targets|SCAN \d+ CONSTANT ROWS|SCAN t)\b/.test(detail)) {
        continue;
      }
      tracker.plans.add(detail);

      const m = detail.match(/\bSCAN\s+(?:TABLE\s+)?([A-Za-z0-9_"]+)/);
      if (m) {
        const alias = m[1].replace(/"/g, "");
        const tbl = alias === "mt" ? "monitor_tag" : alias;
        if (Object.prototype.hasOwnProperty.call(tableCounts, tbl)) {
          scanTables += 1;
          if (isSingleGet && rowsArr.length === 1 && typeof rowsArr[0].id === "number") {
            const cRow = sqlite.prepare(`SELECT COUNT(*) AS c FROM "${tbl}" WHERE rowid <= ?`).get(rowsArr[0].id);
            scanRowsFallback += cRow ? Number(cRow.c) : tableCounts[tbl];
          } else {
            scanRowsFallback += tableCounts[tbl];
          }
        }
      } else if (/\bSEARCH\b/.test(detail)) {
        searchNodes += 1;
      }
    }

    let scannedHere = 0;
    if (typeof fsSteps === "number" && scanTables > 0) {
      // Real C-level sqlite3_stmt_status(SQLITE_STMTSTATUS_FULLSCAN_STEP) + initial seek rows + joined index seeks
      const initRows = returnedCount > 0 || scanRowsFallback > 0 ? scanTables : 0;
      scannedHere = fsSteps + initRows + searchNodes * returnedCount;
    } else if (scanTables > 0) {
      scannedHere = scanRowsFallback + searchNodes * returnedCount;
    } else if (searchNodes > 0) {
      scannedHere = searchNodes * Math.max(1, returnedCount);
    }

    tracker.rowsScanned += Math.max(returnedCount, scannedHere);
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
    track(tracker, sql, rows, rows.length, estimateBytes(rows), fsSteps, false);
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
    track(tracker, sql, row ? [row] : [], row ? 1 : 0, row ? estimateBytes(row) : 0, fsSteps, true);
    return row;
  }

  function newTracker() {
    return { queryCount: 0, rowsScanned: 0, internalBytesRead: 0, fullscanSteps: 0, plans: new Set() };
  }

  function close() {
    stmtCache.clear();
    explainCache.clear();
    sqlite.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }

  return { datasetRows: MONITORS_TOTAL * HEARTBEATS_PER_MONITOR, newTracker, queryAll, queryGet, close };
}

// Verbatim reproduction of louislam/uptime-kuma StatusPage.getStatusPageData + Group.toPublicJSON + Monitor.toPublicJSON
function runBaselineStatusPageData(db, slug = "prod-status", tracker = null) {
  const statusPage = db.queryGet(tracker, "SELECT * FROM status_page WHERE slug = ?", [slug]);

  const config = {
    slug: statusPage.slug,
    title: statusPage.title,
    description: statusPage.description,
    icon: statusPage.icon,
    theme: statusPage.theme,
    published: !!statusPage.published,
    showTags: !!statusPage.show_tags,
    showCertificateExpiry: !!statusPage.show_certificate_expiry,
  };

  const incidents = db
    .queryAll(
      tracker,
      "SELECT * FROM incident WHERE pin = 1 AND active = 1 AND status_page_id = ? ORDER BY created_date DESC",
      [statusPage.id]
    )
    .map((inc) => ({
      id: inc.id,
      style: inc.style,
      title: inc.title,
      content: inc.content,
      pin: !!inc.pin,
      active: !!inc.active,
      createdDate: inc.created_date,
    }));

  const maintenanceList = db.queryAll(
    tracker,
    "SELECT DISTINCT maintenance_id FROM maintenance_status_page WHERE status_page_id = ?",
    [statusPage.id]
  );

  const groups = db.queryAll(
    tracker,
    'SELECT * FROM "group" WHERE public = 1 AND status_page_id = ? ORDER BY weight',
    [statusPage.id]
  );

  const publicGroupList = [];
  for (const grp of groups) {
    const monitorRows = db.queryAll(
      tracker,
      `SELECT monitor.*, monitor_group.send_url, monitor_group.custom_url
       FROM monitor, monitor_group
       WHERE monitor.id = monitor_group.monitor_id
         AND group_id = ?
       ORDER BY monitor_group.weight`,
      [grp.id]
    );

    const monitorList = [];
    for (const mon of monitorRows) {
      const item = {
        id: mon.id,
        name: mon.name,
        sendUrl: !!mon.send_url,
        type: mon.type,
      };
      if (mon.send_url) {
        item.url = mon.custom_url ?? mon.url;
      }
      if (config.showTags) {
        item.tags = db.queryAll(
          tracker,
          "SELECT mt.*, tag.name, tag.color FROM monitor_tag mt JOIN tag ON mt.tag_id = tag.id WHERE mt.monitor_id = ? ORDER BY tag.name, mt.id",
          [mon.id]
        );
      }
      if (config.showCertificateExpiry) {
        const tlsRow = db.queryGet(
          tracker,
          "SELECT * FROM monitor_tls_info WHERE monitor_id = ?",
          [mon.id]
        );
        let certExpiryDaysRemaining = "";
        let validCert = false;
        if (tlsRow && tlsRow.info_json) {
          const parsed = JSON.parse(tlsRow.info_json);
          if (parsed?.valid && parsed?.certInfo?.daysRemaining) {
            certExpiryDaysRemaining = parsed.certInfo.daysRemaining;
            validCert = true;
          }
        }
        item.certExpiryDaysRemaining = certExpiryDaysRemaining;
        item.validCert = validCert;
      }
      monitorList.push(item);
    }

    publicGroupList.push({
      id: grp.id,
      name: grp.name,
      weight: grp.weight,
      monitorList,
    });
  }

  return {
    data: { config, incidents, publicGroupList, maintenanceList },
    tracker,
  };
}

// Verbatim reproduction of louislam/uptime-kuma StatusPage.getRSSPageData (status_page.js:277-307)
function runBaselineRssPageData(db, slug = "prod-status", tracker = null) {
  const { data } = runBaselineStatusPageData(db, slug, tracker);
  const heartbeats = [];

  for (const monitorGroup of data.publicGroupList) {
    for (const monitor of monitorGroup.monitorList) {
      const hb = db.queryGet(
        tracker,
        "SELECT * FROM heartbeat WHERE monitor_id = ? ORDER BY time DESC LIMIT 1",
        [monitor.id]
      );
      if (hb) {
        heartbeats.push({
          ...monitor,
          status: hb.status,
          time: hb.time,
        });
      }
    }
  }

  const downHeartbeats = heartbeats.filter((hb) => hb.status === STATUS_DOWN);
  return {
    data: {
      incidents: data.incidents,
      heartbeats: downHeartbeats,
    },
    tracker,
  };
}

// Unslopped: indexed + batched IN queries + explicit monitor column projection (zero SELECT monitor.*)
function runUnsloppedStatusPageData(db, slug = "prod-status", tracker = null) {
  const statusPage = db.queryGet(
    tracker,
    "SELECT id, slug, title, description, icon, theme, published, show_tags, show_certificate_expiry FROM status_page WHERE slug = ?",
    [slug]
  );

  const config = {
    slug: statusPage.slug,
    title: statusPage.title,
    description: statusPage.description,
    icon: statusPage.icon,
    theme: statusPage.theme,
    published: !!statusPage.published,
    showTags: !!statusPage.show_tags,
    showCertificateExpiry: !!statusPage.show_certificate_expiry,
  };

  const incidents = db
    .queryAll(
      tracker,
      "SELECT id, style, title, content, pin, active, created_date FROM incident WHERE pin = 1 AND active = 1 AND status_page_id = ? ORDER BY created_date DESC",
      [statusPage.id]
    )
    .map((inc) => ({
      id: inc.id,
      style: inc.style,
      title: inc.title,
      content: inc.content,
      pin: !!inc.pin,
      active: !!inc.active,
      createdDate: inc.created_date,
    }));

  const maintenanceList = db.queryAll(
    tracker,
    "SELECT DISTINCT maintenance_id FROM maintenance_status_page WHERE status_page_id = ?",
    [statusPage.id]
  );

  const groups = db.queryAll(
    tracker,
    'SELECT id, name, weight FROM "group" WHERE public = 1 AND status_page_id = ? ORDER BY weight',
    [statusPage.id]
  );

  const groupIds = groups.map((g) => g.id);
  const monitorsByGroup = new Map();
  const allMonitorIds = [];

  if (groupIds.length > 0) {
    const gPlaceholders = groupIds.map(() => "?").join(", ");
    const joinedMonitors = db.queryAll(
      tracker,
      `SELECT m.id, m.name, m.type, m.url, mg.group_id, mg.send_url, mg.custom_url
       FROM monitor_group mg
       JOIN monitor m ON m.id = mg.monitor_id
       WHERE mg.group_id IN (${gPlaceholders})
       ORDER BY mg.group_id ASC, mg.weight ASC`,
      groupIds
    );
    for (const row of joinedMonitors) {
      if (!monitorsByGroup.has(row.group_id)) monitorsByGroup.set(row.group_id, []);
      monitorsByGroup.get(row.group_id).push(row);
      allMonitorIds.push(row.id);
    }
  }

  const uniqueMonitorIds = [...new Set(allMonitorIds)];
  const tagsByMonitor = new Map();
  const tlsByMonitor = new Map();

  if (uniqueMonitorIds.length > 0) {
    const mPlaceholders = uniqueMonitorIds.map(() => "?").join(", ");
    if (config.showTags) {
      const tagRows = db.queryAll(
        tracker,
        `SELECT mt.id, mt.monitor_id, mt.tag_id, mt.value, tag.name, tag.color
         FROM monitor_tag mt
         JOIN tag ON mt.tag_id = tag.id
         WHERE mt.monitor_id IN (${mPlaceholders})
         ORDER BY tag.name ASC, mt.id ASC`,
        uniqueMonitorIds
      );
      for (const tr of tagRows) {
        if (!tagsByMonitor.has(tr.monitor_id)) tagsByMonitor.set(tr.monitor_id, []);
        tagsByMonitor.get(tr.monitor_id).push(tr);
      }
    }
    if (config.showCertificateExpiry) {
      const tlsRows = db.queryAll(
        tracker,
        `SELECT monitor_id, info_json FROM monitor_tls_info WHERE monitor_id IN (${mPlaceholders})`,
        uniqueMonitorIds
      );
      for (const lr of tlsRows) {
        tlsByMonitor.set(lr.monitor_id, lr.info_json);
      }
    }
  }

  const publicGroupList = groups.map((grp) => {
    const rows = monitorsByGroup.get(grp.id) || [];
    const monitorList = rows.map((mon) => {
      const item = {
        id: mon.id,
        name: mon.name,
        sendUrl: !!mon.send_url,
        type: mon.type,
      };
      if (mon.send_url) {
        item.url = mon.custom_url ?? mon.url;
      }
      if (config.showTags) {
        item.tags = tagsByMonitor.get(mon.id) || [];
      }
      if (config.showCertificateExpiry) {
        const infoJson = tlsByMonitor.get(mon.id);
        let certExpiryDaysRemaining = "";
        let validCert = false;
        if (infoJson) {
          const parsed = JSON.parse(infoJson);
          if (parsed?.valid && parsed?.certInfo?.daysRemaining) {
            certExpiryDaysRemaining = parsed.certInfo.daysRemaining;
            validCert = true;
          }
        }
        item.certExpiryDaysRemaining = certExpiryDaysRemaining;
        item.validCert = validCert;
      }
      return item;
    });
    return {
      id: grp.id,
      name: grp.name,
      weight: grp.weight,
      monitorList,
    };
  });

  return {
    data: { config, incidents, publicGroupList, maintenanceList },
    tracker,
  };
}

function runUnsloppedRssPageData(db, slug = "prod-status", tracker = null) {
  const { data } = runUnsloppedStatusPageData(db, slug, tracker);
  const monitorIds = [];
  for (const g of data.publicGroupList) {
    for (const m of g.monitorList) monitorIds.push(m.id);
  }
  const uniqueIds = [...new Set(monitorIds)];
  const latestHbMap = new Map();

  if (uniqueIds.length > 0) {
    const valueTuples = uniqueIds.map(() => "(?)").join(", ");
    const rows = db.queryAll(
      tracker,
      `WITH targets(mid) AS (VALUES ${valueTuples})
       SELECT h.monitor_id, h.status, h.time
       FROM targets t
       JOIN heartbeat h ON h.id = (
         SELECT h2.id
         FROM heartbeat h2
         WHERE h2.monitor_id = t.mid
         ORDER BY h2.time DESC
         LIMIT 1
       )`,
      uniqueIds
    );
    for (const r of rows) latestHbMap.set(r.monitor_id, r);
  }

  const downHeartbeats = [];
  for (const monitorGroup of data.publicGroupList) {
    for (const monitor of monitorGroup.monitorList) {
      const hb = latestHbMap.get(monitor.id);
      if (hb && hb.status === STATUS_DOWN) {
        downHeartbeats.push({
          ...monitor,
          status: hb.status,
          time: hb.time,
        });
      }
    }
  }

  return {
    data: {
      incidents: data.incidents,
      heartbeats: downHeartbeats,
    },
    tracker,
  };
}

function measureWorkload(timedFn, telemetryFn, iterations, warmup) {
  for (let w = 0; w < warmup; w += 1) timedFn();
  const durations = [];
  const heapBefore = process.memoryUsage().heapUsed;
  let lastTimed = null;
  for (let i = 0; i < iterations; i += 1) {
    const t0 = process.hrtime.bigint();
    lastTimed = timedFn();
    durations.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  const heapDeltaKb = Number(Math.max(0, (process.memoryUsage().heapUsed - heapBefore) / 1024).toFixed(2));
  durations.sort((a, b) => a - b);

  // Separate un-timed instrumentation pass so JSON byte counting / EXPLAIN / stat never bias latency
  const telemetry = telemetryFn();
  if (canonicalJsonSha256(lastTimed.data) !== canonicalJsonSha256(telemetry.data)) {
    throw new Error("Timed vs telemetry parity mismatch");
  }

  return {
    durations,
    heapDeltaKb,
    last: telemetry,
  };
}

function runUptimeKumaBenchmark({ iterations = 15, warmup = 3, forceFallbackStats = false } = {}) {
  const baseDb = createUptimeKumaSqliteFixture({ withFixIndexes: false, forceFallbackStats });
  const fixDb = createUptimeKumaSqliteFixture({ withFixIndexes: true, forceFallbackStats });

  try {
    const bStatus = measureWorkload(
      () => runBaselineStatusPageData(baseDb, "prod-status", null),
      () => runBaselineStatusPageData(baseDb, "prod-status", baseDb.newTracker()),
      iterations,
      warmup
    );
    const bRss = measureWorkload(
      () => runBaselineRssPageData(baseDb, "prod-status", null),
      () => runBaselineRssPageData(baseDb, "prod-status", baseDb.newTracker()),
      iterations,
      warmup
    );

    const aStatus = measureWorkload(
      () => runUnsloppedStatusPageData(fixDb, "prod-status", null),
      () => runUnsloppedStatusPageData(fixDb, "prod-status", fixDb.newTracker()),
      iterations,
      warmup
    );
    const aRss = measureWorkload(
      () => runUnsloppedRssPageData(fixDb, "prod-status", null),
      () => runUnsloppedRssPageData(fixDb, "prod-status", fixDb.newTracker()),
      iterations,
      warmup
    );

    const toEntry = (id, label, cmd, res) => {
      const payload = JSON.stringify(res.last.data);
      const t = res.last.tracker;
      return {
        workload_id: id,
        endpoint_or_task: label,
        command: cmd,
        response_status: 200,
        golden_sha256: canonicalJsonSha256(res.last.data),
        queries_per_req: t.queryCount,
        rows_scanned: t.rowsScanned,
        internal_bytes_read: t.internalBytesRead,
        payload_bytes: Buffer.byteLength(payload, "utf8"),
        p50_ms: percentile(res.durations, 50),
        p95_ms: percentile(res.durations, 95),
        p99_ms: percentile(res.durations, 99),
        heap_delta_kb: res.heapDeltaKb,
        explain_plan_type: [...t.plans].join(" | ") || "NONE",
      };
    };

    const cmd = "node examples/case-studies/uptime-kuma/reproduce.cjs";
    const capturedAt = new Date().toISOString();

    const baseline = {
      schema_version: "1.0",
      run_id: "uptime-kuma-baseline",
      phase: "baseline",
      target_commit: UPSTREAM_COMMIT,
      captured_at: capturedAt,
      cache_mode: "warm",
      dataset_rows: baseDb.datasetRows,
      iterations,
      warmup_iterations: warmup,
      workloads: [
        toEntry("uptime-kuma-status-page-data", "StatusPage.getStatusPageData (10 groups, 100 monitors)", cmd, bStatus),
        toEntry("uptime-kuma-rss-page-data", "StatusPage.getRSSPageData (100 monitors)", cmd, bRss),
      ],
    };

    const after = {
      schema_version: "1.0",
      run_id: "uptime-kuma-unslopped",
      phase: "after",
      target_commit: UPSTREAM_COMMIT,
      captured_at: capturedAt,
      cache_mode: "warm",
      dataset_rows: fixDb.datasetRows,
      iterations,
      warmup_iterations: warmup,
      workloads: [
        toEntry("uptime-kuma-status-page-data", "StatusPage.getStatusPageData (10 groups, 100 monitors)", cmd, aStatus),
        toEntry("uptime-kuma-rss-page-data", "StatusPage.getRSSPageData (100 monitors)", cmd, aRss),
      ],
    };

    return { baseline, after };
  } finally {
    baseDb.close();
    fixDb.close();
  }
}

function parseArgs(argv) {
  const opts = { outBaseline: null, outAfter: null, iterations: 15, warmup: 3 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--out-baseline") opts.outBaseline = argv[++i];
    else if (a === "--out-after") opts.outAfter = argv[++i];
    else if (a === "--iterations") opts.iterations = Number.parseInt(argv[++i], 10);
    else if (a === "--warmup") opts.warmup = Number.parseInt(argv[++i], 10);
    else throw new Error(`Unknown flag: ${a}`);
  }
  return opts;
}

if (require.main === module) {
  const opts = parseArgs(process.argv.slice(2));
  const { baseline, after } = runUptimeKumaBenchmark(opts);
  const { compareBenchmarks, formatComparisonMarkdown } = require("../../../skills/unslop-backend/compare-benchmarks.cjs");
  const gate = compareBenchmarks(baseline, after);

  if (opts.outBaseline) {
    const p = path.resolve(opts.outBaseline);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  }
  if (opts.outAfter) {
    const p = path.resolve(opts.outAfter);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, `${JSON.stringify(after, null, 2)}\n`, "utf8");
  }

  console.log(formatComparisonMarkdown(gate));
  process.exit(gate.ok ? 0 : 1);
}

module.exports = {
  UPSTREAM_COMMIT,
  runUptimeKumaBenchmark,
};
