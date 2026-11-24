# Phase 1: Backend Reconnaissance & Workload Ledger

Map every performance-sensitive surface before reading individual functions for anti-patterns. Guessing which endpoints matter wastes tokens and misses hidden background exports, unindexed migrations, or chatty ORM hooks.

---

## Step 1: Pre-Scan for Candidate Leads (Optional Seed)

Run the zero-dependency static pre-scanner to spot obvious candidate hotspots quickly:

```bash
node <skill-dir>/scan-slop.cjs <repo-root> --json > <output-dir>/static-leads.json
```

Treat `static-leads.json` strictly as **hunting hints**, never as confirmed findings.

---

## Step 2: Launch 4 Parallel `research` Agents

Split codebase mapping across four read-only `research` agents:

1. **Agent A — Entrypoints & Hot Paths:** HTTP routes, GraphQL resolvers, gRPC/tRPC/RPC handlers, server actions, middleware chains, pagination/export endpoints.
2. **Agent B — Schemas, ORMs, Raw SQL & Migrations:** ORM definitions (Prisma, Drizzle, TypeORM, SQLAlchemy, Django, GORM, ActiveRecord), SQL files, migration history, declared indexes, foreign keys, and repository wrappers.
3. **Agent C — Background Workers, Streams, External I/O & AI Pipelines:** Cron jobs, queue consumers, CSV/PDF/JSON export builders, file upload/download handlers, outbound HTTP fans, embedding/LLM call loops.
4. **Agent D — Local Benchmark & Profiling Harness:** Available DB engines (Postgres/SQLite/MySQL/Docker), existing seed scripts, test runners, query logging middleware, and memory/cold-start entrypoints (serverless handlers, CLI startup).

---

## Step 3: Write `architecture.md` and `workload-ledger.json`

Synthesize agent outputs into:
1. `<output-dir>/architecture.md`: data stores, ORM/query layers, estimated table sizes in production, key external dependencies, and how local benchmarks can safely run.
2. `<output-dir>/workload-ledger.json` matching [`workload-ledger-schema.json`](workload-ledger-schema.json):

Supported `surface_type` values:
- `http_route`
- `graphql_resolver`
- `rpc_handler`
- `orm_repository`
- `raw_sql`
- `migration_index`
- `background_job`
- `export_stream`
- `ai_pipeline`
- `serverless_entry`

Initial status for every in-scope unit must be `unassigned` (with `checked_classes: []`, `hunter_run_id: ""`), or `out_of_scope` with an explicit `notes` reason (e.g., static docs/dev scripts).

---

## Step 4: Mechanical Ledger Gate

Before moving to Phase 2, validate exact file paths and line boundaries:

```bash
node <skill-dir>/validate-workload-ledger.cjs --repo-root <repo-root> <output-dir>/workload-ledger.json
```

Fix any invalid file paths, inverted line ranges, or duplicate `unit_id` values immediately.
