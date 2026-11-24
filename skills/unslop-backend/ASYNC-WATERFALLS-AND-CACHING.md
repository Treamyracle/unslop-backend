# Async Waterfalls, Batching & Safe Caching

Load this playbook when handlers chain sequential `await` calls, fan out unbounded promises, or hammer identical upstream queries.

---

## 1. Sequential Async Waterfalls
```js
// SLOP: 4 independent waits run serially (~4x latency)
const tier = await billing.getTier(orgId);
const tax = await taxClient.getRate(country);
const sla = await shipping.getSla(region);
const loyalty = await loyalty.getScore(userId);
```

**Safe Unslop Fix:**
```js
// UNSLOPPED: independent reads run concurrently (~1x latency)
const [tier, tax, sla, loyalty] = await Promise.all([
  billing.getTier(orgId),
  taxClient.getRate(country),
  shipping.getSla(region),
  loyalty.getScore(userId),
]);
```
- **Python equivalent:** `asyncio.gather(...)` (never sequential `await` for independent I/O).
- **Go equivalent:** `errgroup.WithContext(ctx)`.

---

## 2. Concurrency Caps & Singleflight
- **Fixed tuple vs. dynamic array:** `Promise.all` over 4 fixed independent calls is great. `Promise.all(items.map(...))` over 5,000 dynamic items is dangerous (exhausts DB pools / file descriptors). Bound dynamic fan-out with a concurrency limiter (`p-limit` style chunking of `5–20`) or batch at the SQL/API layer instead.
- **Singleflight / Request Coalescing:** When identical expensive read keys (e.g., org configuration, public catalog, JWKS) get hit concurrently by 50 requests during cache miss, coalesce in-flight promises by key so only 1 upstream fetch runs while all 50 callers await the same promise (and remove from in-flight map in `finally` on error!).

---

## 3. Safe Caching Rules (Zero Cross-Tenant Leaks)
Before adding any in-process bounded cache:
1. **Must be bounded (`maxEntries` LRU + `ttlMs`):** Unbounded `new Map()` caches leak memory until OOM.
2. **Must include isolation dimensions in cache key:** `tenant_id` / `org_id` / `user_id` / `role` / locale / query parameters.
3. **Never cheat benchmarks with warm cache:** Baseline and after-fix runs must share identical `cache_mode` (`cold` or `warm`). A cache hit against an uncached cold baseline is an invalid benchmark (`compare-benchmarks.cjs` rejects mismatched `cache_mode`).
4. **Write invalidation:** Document whether stale TTL (`<= N seconds`) is acceptable or mutate/invalidate on write paths.
