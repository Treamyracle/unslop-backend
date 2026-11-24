# ORM & N+1 Cascade Hunting

Load this companion playbook when the target codebase uses Prisma, Drizzle, TypeORM, Sequelize, SQLAlchemy, Django ORM, ActiveRecord, GORM, or Entity Framework.

---

## 1. Where N+1 Slop Hides
1. **Explicit `for` / `.map()` / list-comprehension loops:** Calling `findUnique`, `findFirst`, `session.get()`, `db.First()`, or lazy relationship attributes (`order.user`, `order.items`) inside per-row iteration.
2. **GraphQL field resolvers:** A parent resolver returns 50 orders; child resolvers (`Order.customer`, `Order.lineItems`) fire 1 query per parent field without `DataLoader`.
3. **Hidden ORM lazy-loading / getters:** Django templates or serializers accessing `obj.tags.all()` without `prefetch_related("tags")`; SQLAlchemy `lazy="select"` relationships accessed during Pydantic/JSON serialization.
4. **Loop-driven upserts & updates:** Calling `await prisma.item.update(...)` 200 times in a loop instead of bulk `UPDATE ... FROM (VALUES ...)` or `createMany` / `bulk_update`.

---

## 2. Exact Fix Patterns by ORM

| Stack | Sloppy Pattern | Safe Unslopped Fix |
|---|---|---|
| **Prisma** | `for (const o of orders) await prisma.user.findUnique(...)` | `prisma.order.findMany({ select: ..., include: { user: { select: ... } } })` or collect unique IDs → single `where: { id: { in: ids } }` |
| **Drizzle** | Looping `db.select().from(items).where(eq(items.orderId, o.id))` | `inArray(items.orderId, orderIds)` grouped via `Map`, or relational `db.query.orders.findMany({ with: ... })` |
| **SQLAlchemy** | Iterating `order.items` with default `lazy="select"` | `options(selectinload(Order.items), joinedload(Order.user))` + `load_only(...)` |
| **Django ORM** | `Order.objects.filter(...)` then reading `.user` & `.items.all()` | `select_related("user").prefetch_related("items").only(...)` |
| **Go (GORM)** | Looping `db.Where("order_id = ?", o.ID).Find(&items)` | `Preload("Items")` or batch `Where("order_id IN ?", orderIDs)` |
| **GraphQL** | Per-field resolver calling `repo.getById(parent.userId)` | Request-scoped `DataLoader` batching keys into single `WHERE id IN (...)` |

---

## 3. Skeptic Checklist (Avoid Regressions)
- **Cartesian explosion from multiple `JOIN`s:** Joining two `1:N` child tables (`orders JOIN items JOIN refunds`) duplicates rows `|items| × |refunds|`. Use `selectinload` / 2 batched `IN (...)` queries rather than a multiplying `JOIN`.
- **Empty `IN ()` syntax error:** Guard `if (ids.length === 0) return new Map()` before running raw SQL `WHERE id IN (...)`.
- **Parameter bind limit:** Chunk `ids` into batches of `<= 1,000` (SQLite `SQLITE_MAX_VARIABLE_NUMBER` or Oracle limits; Postgres `ANY($1::uuid[])` avoids bind limits cleanly).
- **Duplicate preservation:** Preserve `null` vs `[]` shape for missing relations so `golden_sha256` matches byte-for-byte.
