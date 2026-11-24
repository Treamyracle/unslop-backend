"use strict";

const http = require("node:http");

/**
 * Unoptimized SaaS API backed by real node:sqlite (no indexes on orders/order_items)
 * and real local gzip-shard HTTP enrichment calls:
 *  1. GET /api/orgs/:orgId/orders          -> SCAN orders + TEMP B-TREE + 100 N+1 queries
 *  2. GET /api/orgs/:orgId/dashboard       -> SELECT * FROM orders + in-app JS aggregation
 *  3. GET /api/orders/:orderId/enrichment  -> 4 sequential HTTP calls reading .json.gz shards
 *  4. GET /api/orgs/:orgId/orders/export   -> SELECT * blobs + JSON.parse(JSON.stringify) loop
 */
function createSloppyServer(db) {
  return http.createServer(async (req, res) => {
    const tracker = req.headers["x-unslop-telemetry"] === "1" ? db.newRequestTracker() : null;
    const url = new URL(req.url, "http://127.0.0.1");
    const pathname = url.pathname;

    try {
      const ordersMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/orders$/);
      if (req.method === "GET" && ordersMatch) {
        const orgId = decodeURIComponent(ordersMatch[1]);
        const status = url.searchParams.get("status") || "paid";
        const limit = Number.parseInt(url.searchParams.get("limit") || "50", 10);

        const orders = db.queryAll(
          tracker,
          "SELECT * FROM orders WHERE org_id = ? AND status = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          [orgId, status, limit]
        );

        const enriched = [];
        for (const order of orders) {
          const customer = db.queryGet(tracker, "SELECT * FROM users WHERE id = ?", [order.user_id]);
          const items = db.queryAll(tracker, "SELECT * FROM order_items WHERE order_id = ?", [order.id]);
          enriched.push({
            id: order.id,
            status: order.status,
            total_cents: order.total_cents,
            created_at: order.created_at,
            customer: customer ? { id: customer.id, name: customer.name, tier: customer.tier } : null,
            item_count: items.length,
            skus: items.map((it) => it.sku),
          });
        }

        return sendJson(res, 200, { org_id: orgId, orders: enriched }, tracker);
      }

      const dashMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/dashboard$/);
      if (req.method === "GET" && dashMatch) {
        const orgId = decodeURIComponent(dashMatch[1]);
        const allOrgOrders = db.queryAll(tracker, "SELECT * FROM orders WHERE org_id = ?", [orgId]);

        let paidOrders = 0;
        let totalRevenueCents = 0;
        const revenueByUser = new Map();

        for (const row of allOrgOrders) {
          if (row.status === "paid") {
            paidOrders += 1;
            totalRevenueCents += row.total_cents;
            revenueByUser.set(row.user_id, (revenueByUser.get(row.user_id) || 0) + row.total_cents);
          }
        }

        const topEntries = [...revenueByUser.entries()]
          .sort((a, b) => {
            if (b[1] !== a[1]) return b[1] - a[1];
            return a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0;
          })
          .slice(0, 5);

        const topCustomers = [];
        for (const [userId, cents] of topEntries) {
          const user = db.queryGet(tracker, "SELECT * FROM users WHERE id = ?", [userId]);
          topCustomers.push({
            user_id: userId,
            name: user ? user.name : null,
            total_cents: cents,
          });
        }

        return sendJson(
          res,
          200,
          {
            org_id: orgId,
            total_orders: allOrgOrders.length,
            paid_orders: paidOrders,
            total_revenue_cents: totalRevenueCents,
            top_customers: topCustomers,
          },
          tracker
        );
      }

      const enrichMatch = pathname.match(/^\/api\/orders\/([^/]+)\/enrichment$/);
      if (req.method === "GET" && enrichMatch) {
        const orderId = decodeURIComponent(enrichMatch[1]);
        const billingTier = await db.fetchEnrichmentLocal(tracker, "billing_tier", orderId);
        const taxRate = await db.fetchEnrichmentLocal(tracker, "tax_rate", orderId);
        const shippingSla = await db.fetchEnrichmentLocal(tracker, "shipping_sla", orderId);
        const loyaltyScore = await db.fetchEnrichmentLocal(tracker, "loyalty_score", orderId);

        return sendJson(
          res,
          200,
          {
            order_id: orderId,
            billing_tier: billingTier,
            tax_rate: taxRate,
            shipping_sla: shippingSla,
            loyalty_score: loyaltyScore,
          },
          tracker
        );
      }

      const exportMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/orders\/export$/);
      if (req.method === "GET" && exportMatch) {
        const orgId = decodeURIComponent(exportMatch[1]);
        const limit = Number.parseInt(url.searchParams.get("limit") || "200", 10);
        const rows = db.queryAll(
          tracker,
          "SELECT * FROM orders WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          [orgId, limit]
        );

        const exported = [];
        for (const row of rows) {
          const cloned = JSON.parse(JSON.stringify(row));
          exported.push(cloned);
        }

        return sendJson(res, 200, { org_id: orgId, rows: exported }, tracker);
      }

      return sendJson(res, 404, { error: "Not found" }, tracker);
    } catch (err) {
      return sendJson(res, 500, { error: err.message }, tracker);
    }
  });
}

function sendJson(res, status, payload, tracker) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body, "utf8"),
    "x-unslop-queries": String(tracker ? tracker.queryCount : 0),
    "x-unslop-rows-scanned": String(tracker ? tracker.rowsScanned : 0),
    "x-unslop-internal-bytes": String(tracker ? tracker.internalBytesRead : 0),
    "x-unslop-plan": tracker ? [...tracker.plans].join(" | ") || "NONE" : "UNTIMED",
  });
  res.end(body);
}

module.exports = { createSloppyServer };
