"use strict";

const http = require("node:http");

/**
 * Unslopped SaaS API backed by real node:sqlite composite indexes, SQL aggregation,
 * batched IN queries, explicit column projections, and parallel HTTP fan-out.
 */
function createUnsloppedServer(db) {
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
          "SELECT id, user_id, status, total_cents, created_at FROM orders WHERE org_id = ? AND status = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          [orgId, status, limit]
        );

        const userIds = [...new Set(orders.map((o) => o.user_id))];
        const orderIds = [...new Set(orders.map((o) => o.id))];

        const usersMap = new Map();
        if (userIds.length > 0) {
          const uPlaceholders = userIds.map(() => "?").join(", ");
          const userRows = db.queryAll(
            tracker,
            `SELECT id, name, tier FROM users WHERE id IN (${uPlaceholders})`,
            userIds
          );
          for (const u of userRows) usersMap.set(u.id, u);
        }

        const itemsMap = new Map();
        if (orderIds.length > 0) {
          const oPlaceholders = orderIds.map(() => "?").join(", ");
          const itemRows = db.queryAll(
            tracker,
            `SELECT order_id, sku FROM order_items WHERE order_id IN (${oPlaceholders}) ORDER BY id ASC`,
            orderIds
          );
          for (const it of itemRows) {
            if (!itemsMap.has(it.order_id)) itemsMap.set(it.order_id, []);
            itemsMap.get(it.order_id).push(it.sku);
          }
        }

        const enriched = orders.map((order) => {
          const customer = usersMap.get(order.user_id) || null;
          const skus = itemsMap.get(order.id) || [];
          return {
            id: order.id,
            status: order.status,
            total_cents: order.total_cents,
            created_at: order.created_at,
            customer: customer ? { id: customer.id, name: customer.name, tier: customer.tier } : null,
            item_count: skus.length,
            skus,
          };
        });

        return sendJson(res, 200, { org_id: orgId, orders: enriched }, tracker);
      }

      const dashMatch = pathname.match(/^\/api\/orgs\/([^/]+)\/dashboard$/);
      if (req.method === "GET" && dashMatch) {
        const orgId = decodeURIComponent(dashMatch[1]);
        const totals = db.queryGet(
          tracker,
          `SELECT
             COUNT(*) AS total_orders,
             COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) AS paid_orders,
             COALESCE(SUM(CASE WHEN status = 'paid' THEN total_cents ELSE 0 END), 0) AS total_revenue_cents
           FROM orders
           WHERE org_id = ?`,
          [orgId]
        );

        const topCustomers = db.queryAll(
          tracker,
          `SELECT agg.user_id AS user_id, u.name AS name, agg.total_cents AS total_cents
           FROM (
             SELECT user_id, SUM(total_cents) AS total_cents
             FROM orders
             WHERE org_id = ? AND status = 'paid'
             GROUP BY user_id
             ORDER BY total_cents DESC, user_id ASC
             LIMIT 5
           ) agg
           LEFT JOIN users u ON u.id = agg.user_id
           ORDER BY agg.total_cents DESC, agg.user_id ASC`,
          [orgId]
        );

        return sendJson(
          res,
          200,
          {
            org_id: orgId,
            total_orders: totals ? totals.total_orders : 0,
            paid_orders: totals ? totals.paid_orders : 0,
            total_revenue_cents: totals ? totals.total_revenue_cents : 0,
            top_customers: topCustomers.map((c) => ({
              user_id: c.user_id,
              name: c.name ?? null,
              total_cents: c.total_cents,
            })),
          },
          tracker
        );
      }

      const enrichMatch = pathname.match(/^\/api\/orders\/([^/]+)\/enrichment$/);
      if (req.method === "GET" && enrichMatch) {
        const orderId = decodeURIComponent(enrichMatch[1]);
        const [billingTier, taxRate, shippingSla, loyaltyScore] = await Promise.all([
          db.fetchEnrichmentLocal(tracker, "billing_tier", orderId),
          db.fetchEnrichmentLocal(tracker, "tax_rate", orderId),
          db.fetchEnrichmentLocal(tracker, "shipping_sla", orderId),
          db.fetchEnrichmentLocal(tracker, "loyalty_score", orderId),
        ]);

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
          "SELECT id, org_id, user_id, status, total_cents, currency, created_at FROM orders WHERE org_id = ? ORDER BY created_at DESC, id DESC LIMIT ?",
          [orgId, limit]
        );

        return sendJson(res, 200, { org_id: orgId, rows }, tracker);
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

module.exports = { createUnsloppedServer };
