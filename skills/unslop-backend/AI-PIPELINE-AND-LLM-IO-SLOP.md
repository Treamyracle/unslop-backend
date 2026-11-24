# AI Pipeline & LLM I/O Slop

Load this playbook when backend routes, background workers, or ingestion pipelines invoke LLM APIs, embedding endpoints, or vector databases.

---

## 1. High-Cost AI Pipeline Slop Patterns
1. **Per-chunk embedding waterfall (`1` HTTP call per chunk):** Splitting a document into 80 chunks and running `await embed(chunk)` inside a `for` loop instead of batching `[chunks]` into 1–2 batch embedding requests.
2. **Repeated identical prompt/tool/embedding calls:** Re-embedding identical queries or calling deterministic classification/moderation prompts repeatedly without a tenant-scoped cache or deduplication key.
3. **Context-stuffing overfetch:** Querying vector DB + SQL for top-50 full documents (`SELECT *`, entire raw HTML/JSON) when only top-5 summaries fit or contribute to context — exploding TTFT (time-to-first-token), input token spend, and DB bandwidth.
4. **Blocking full-completion waits & holding DB connections:** Waiting 15–40 seconds for full LLM completion before writing bytes when SSE streaming is expected, or opening a Postgres transaction *before* calling an external LLM API (starving the DB connection pool).

---

## 2. Safe Unslop Fixes (Using Local Mock Replay Harness)
- **Batch embeddings:** Group chunks up to provider batch limits (e.g., 64–256 strings/call) with bounded concurrency (`<= 4` concurrent batches).
- **Close transactions before external I/O:** Read DB inputs → commit/release DB connection → call LLM/embedding API → open short write transaction for persistence.
- **Deterministic local verification:** Never burn paid external LLM tokens inside automated benchmark suites! Mock the local HTTP LLM endpoint with deterministic response payloads & fixed simulated latency (`127.0.0.1`), verify exact output equivalence (`golden_sha256`), and measure total external HTTP call count, input payload bytes, and end-to-end `p95_ms`.
