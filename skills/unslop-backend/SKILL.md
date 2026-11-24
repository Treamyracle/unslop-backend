---
name: unslop-backend
description: Six-phase measurement-first backend performance and data-slop elimination skill for APIs, ORM repositories, SQL queries, async jobs, export streams, and AI pipelines. Hunts N+1 cascades, missing indexes, SELECT * payload bloat, in-app aggregation, async waterfalls, connection bloat, stream buffering, and cold-start overhead — then proves every fix with before/after benchmarks and golden SHA-256 equivalence.
---

# Unslop Backend

Eliminate runtime backend performance slop without changing API behavior.

Unlike UI styling checkers (`heydamir/unslop`), code-style linters (`desloppify`, `anti-slop`), CPU-to-Rust rewriters (`fast-anything`), or concurrency race hunters (`chaos-audit-skill`), `unslop-backend` targets **observable data, query, I/O, payload, memory, and cold-start waste** — and blocks any claim of improvement unless **paired local benchmarks** and **canonical golden output SHA-256 hashes** prove equivalence.

---

## Operating Modes

Loading this skill defaults to **Guidance mode**. Never edit tracked repository source files or run multi-phase pipelines unless explicitly requested.

- **Guidance mode** *(default)*: Read-only Q&A for targeted questions (*"Is this endpoint causing an N+1?"*, *"What index fixes this query plan?"*, *"How do we parallelize these awaits safely?"*). Inspect the code and relevant playbook directly and answer concisely. Do not create persistent audit artifacts.
- **Audit mode** *(read-only 6-phase run)*: Triggered when the user asks for an audit or report (*"audit backend performance in ./src"*, *"find SQL and N+1 slop"*). Runs Phases 1–6 read-only, measures local baseline telemetry and query plans, and emits `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md`, and `NEEDS-VALIDATION.md` without modifying application source.
- **Unslop mode** *(explicit opt-in optimization)*: Triggered only when the user asks to fix/unslop the backend (*"unslop ./src/api"*, *"fix the slow endpoints and prove equivalence"*). Creates a working branch, records `baseline.json` + golden output hashes first, applies one minimal behavior-preserving fix per surface, runs `compare-benchmarks.cjs` and a fresh skeptic check, and validates `findings.json`.

If the user's request could mean Audit mode or Unslop mode, ask one clarifying question before modifying any code.

---

## Agent-Neutral Platform Terminology

This skill works across Claude Code, OpenAI Codex, Cursor, Google Antigravity, Gemini CLI, and OpenCode:

- **Parent**: Coordinating agent owning `run-metadata.json`, `workload-ledger.json`, `baseline.json`, `after.json`, `findings.json`, validator gates, and final reports.
- **Task tool**: Platform mechanism for spawning subagents.
- **`research` agent**: Read-only subagent for codebase exploration, schema/index inspection, and line-number verification.
- **`general` agent**: Subagent authorized to run local seed scripts, query-plan checks, benchmark runners, and (in Unslop mode) minimal isolated edits.
- **Never self-verify**: An agent that proposes or implements a fix MUST NOT act as its Phase 5 Fresh Skeptic Verifier.

---

## Universal Execution Safety

These rules govern Guidance, Audit, and Unslop modes without exception:

1. **Never touch production, staging, or external metered APIs.** Run `EXPLAIN`, benchmarks, and load loops strictly against local seeded databases (`>= 1,000` rows per primary table) or loopback test servers (`127.0.0.1`).
2. **Never invent or downgrade contracts silently.** Every optimization must preserve status codes, sorting/tie-breaking order, `NULL` semantics, empty-array shapes, pagination cursors, and tenant authorization filters (`golden_sha256` match).
3. **Never silently provision paid or external infrastructure.** Do not add Redis, RabbitMQ, SQS, managed caches, or cloud proxies during an Unslop pass unless the codebase already runs them; record architectural infra upgrades as recommendations instead.
4. **Never exceed bounded timeouts.** Keep local benchmark runs bounded (`<= 30s` per workload, explicit iteration counts, clean server teardown).
5. **Fail closed when local measurement is blocked.** If missing DB engines, credentials, or external services prevent safe local execution, mark the lead `needs_validation` with `severity: null` and emit an exact `safe_verification_recipe`.

---

## Output Directory & Write Isolation

In **Audit** or **Unslop** mode, unless the user specifies an output directory, write run artifacts outside tracked source paths at:

```text
~/unslop-backend/<repo-name>/run-<N>/
```

Inside `<output-dir>`:
- `run-metadata.json` — target path, `target_commit`, mode (`audit` or `unslop`), toolchain availability, dataset row scale.
- `architecture.md` — synthesized routes, ORM repositories, tables/indexes, external I/O boundaries, and measurement setup.
- `workload-ledger.json` — canonical inventory of surfaces validated by `validate-workload-ledger.cjs`.
- `baseline.json` & *(in Unslop mode)* `after.json` — paired telemetry snapshots validated by `compare-benchmarks.cjs`.
- `findings.json` — structured findings (`fixed`, `confirmed`, `needs_validation`, `rejected`) validated by `validate-findings.cjs`.
- `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md`, `NEEDS-VALIDATION.md` — target-neutral reports derived strictly from validated JSON.

---

## Six-Phase Closed-Loop Workflow

1. **Phase 1 — Reconnaissance & Pre-Scan ([`RECONNAISSANCE.md`](RECONNAISSANCE.md)):**
   Optionally run the zero-dependency pre-scanner for initial candidate leads:
   ```bash
   node <skill-dir>/scan-slop.cjs <target> --json
   ```
   Spawn 4 parallel `research` agents to map routes/resolvers, ORM/SQL/migrations/indexes, jobs/exports/external I/O, and local test/seed tooling. Write `architecture.md` and `workload-ledger.json`, then gate with:
   ```bash
   node <skill-dir>/validate-workload-ledger.cjs --repo-root <target> <output-dir>/workload-ledger.json
   ```

2. **Phase 2 — Baseline & Golden Capture ([`BASELINE-AND-GOLDEN.md`](BASELINE-AND-GOLDEN.md)):**
   Seed realistic local test data (`>= 1,000` rows so N+1 and full table scans separate cleanly from indexed paths). Run warmup iterations, capture paired `cache_mode` (`cold` or `warm`), record query counts, `rows_scanned`, `payload_bytes`, latency percentiles (`p50_ms`, `p95_ms`, `p99_ms`), `heap_delta_kb`, `explain_plan_type`, and canonical JSON `golden_sha256` into `baseline.json`.

3. **Phase 3 — Coverage-Led Slop Hunting ([`HUNTING.md`](HUNTING.md)):**
   Inspect every unit in `workload-ledger.json` against [`SLOP-CLASSES.md`](SLOP-CLASSES.md) and matching companion playbooks (`ORM-AND-N-PLUS-ONE.md`, `SQL-INDEXES-AND-QUERY-PLANS.md`, `PAYLOADS-STREAMING-AND-SERIALIZATION.md`, `ASYNC-WATERFALLS-AND-CACHING.md`, `MEMORY-STREAMS-AND-COLD-STARTS.md`, `AI-PIPELINE-AND-LLM-IO-SLOP.md`). Run a Coverage Critic pass and re-run `validate-workload-ledger.cjs --require-complete`.

4. **Phase 4 — Prove or Unslop ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):**
   - **Audit mode:** Capture reproducible query-count / `EXPLAIN` / profile traces confirming each suspected unit without editing code.
   - **Unslop mode:** On a clean git branch, apply one minimal behavior-preserving fix per surface, write/run a regression guard test, capture `after.json` under identical `cache_mode` and `dataset_rows`, and gate on:
     ```bash
     node <skill-dir>/compare-benchmarks.cjs <output-dir>/baseline.json <output-dir>/after.json
     ```

5. **Phase 5 — Fresh Skeptic Verification ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):**
   Send each `confirmed` or `fixed` candidate to an independent fresh verifier tasked with **breaking** the claim: checking cold-vs-warm bias, missing `ORDER BY` tie-breakers, `NULL` / soft-delete semantic drift, cross-tenant cache key collisions, or excessive write-amplification on newly added indexes. Validate `findings.json` with:
   ```bash
   node <skill-dir>/validate-findings.cjs --repo-root <target> --ledger <output-dir>/workload-ledger.json --baseline <output-dir>/baseline.json --after <output-dir>/after.json <output-dir>/findings.json
   ```

6. **Phase 6 — Target-Neutral Reporting ([`VALIDATION-AND-REPORTING.md`](VALIDATION-AND-REPORTING.md)):**
   Render `REPORT.md`, `BENCHMARKS.md`, `FINDINGS-DETAIL.md`, and `NEEDS-VALIDATION.md` directly from validated JSON artifacts.

---

## Additive Multi-Run Protocol

When `<output-dir>/../run-<N-1>/` exists for the same repo:
- Inspect `git diff <prior-commit>..HEAD` alongside prior `workload-ledger.json` and `findings.json`.
- Carry forward `prior_covered_same_source` only for untouched files and unchanged upstream schemas/indexes.
- Force fresh measurement and validation on modified files and prior `confirmed` / `needs_validation` units.

---

## Strictly Forbidden Anti-Patterns

1. **Never mark static grep hits as `confirmed` or `fixed`.** `scan-slop.cjs` produces *candidate leads only*. Confirmation requires measured baseline evidence.
2. **Never compare cold baseline against warm post-fix.** `compare-benchmarks.cjs` hard-fails on `cache_mode` or `dataset_rows` mismatches.
3. **Never change API payload contracts silently.** If an endpoint deliberately slims overfetched unused fields (`contract_projection_approved: true`), record both explicit contract approval and matching `row_ids_sha256`.
4. **Never claim noise-level wins.** Latency jitter below 20% with zero query/scan/payload/heap reduction is noise, not a proved win.
5. **Never skip the `.cjs` gates.** Always pass `--json` or inspect exit codes across `validate-workload-ledger.cjs`, `compare-benchmarks.cjs`, and `validate-findings.cjs`.
