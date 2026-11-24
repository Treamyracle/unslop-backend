# Memory Buffering, Streams & Serverless Cold-Start Slop

Load this playbook when auditing bulk CSV/NDJSON exports, file processing, long-lived worker processes, or serverless/edge functions.

---

## 1. Memory & Stream Slop Patterns
1. **Whole-export string/array buffering:** Building a 50,000-row CSV or JSON export as `rows.map(...).join("\n")` or buffering an entire upload into `Buffer.concat(chunks)` before streaming to disk/S3/HTTP response.
2. **Synchronous filesystem I/O on request threads:** Calling `fs.readFileSync`, `fs.writeFileSync`, or `fs.existsSync` per HTTP request in Node.js — blocks the single event loop for every concurrent user.
3. **Unbounded module-scope state:** Accumulating request telemetry, cached objects, or active listeners in module-level `Map` / `Set` / `Array` without eviction (`maxEntries`, `WeakMap`, or `TTL`).
4. **Heavy regex compilation or `Intl.DateTimeFormat` instantiation inside loops:** Re-creating formatters/validators per row instead of hoisting to module scope.

---

## 2. Streaming & Cold-Start Fixes
- **Chunked cursor streaming:** Fetch rows in indexed keyset batches (e.g., `500` rows per batch), transform each row directly onto the HTTP response (`res.write(...)`) honoring `drain` backpressure (`pipeline()` / `Readable.from(asyncGenerator)`). Peak heap stays flat `O(batch_size)` instead of `O(total_rows)`.
- **Cold-start barrel trimming:**
  - Slop: `import { formatDate } from "heavy-utils-barrel"` or eager `import AWS from "aws-sdk"` importing 40 MB of unused clients on module load.
  - Fix: Subpath imports (`@aws-sdk/client-s3`) and lazy `await import(...)` inside infrequent branches (PDF generation, admin exports).
- **Measure cold starts fairly:** Measure process spawn -> first response (`cache_mode: "cold"`) across `>= 5` fresh child processes before and after import trimming.

---

## 3. Skeptic Checklist
- **Backpressure & client disconnects:** When streaming HTTP responses, abort DB cursor iteration cleanly on `req.on("close")` so abandoned client exports stop scanning DB rows.
- **CSV injection / delimiter escaping:** Switching from `res.json` or buffered CSV helpers to manual line streaming must keep exact header order, quoting, and newline endings (`\n` vs `\r\n`) so `golden_sha256` matches.
