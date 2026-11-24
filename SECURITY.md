# Security & Safe Benchmarking Policy

`unslop-backend` is a measurement-first performance and data-slop elimination skill for coding agents.

## Execution & Benchmarking Boundaries
- Always run baseline captures, `EXPLAIN` queries, static scans, and after-fix benchmarks strictly against **local seeded databases, loopback test servers, or disposable local scratch environments**.
- Never run repeated benchmark iterations, payload exports, or query-plan stress probes against live production endpoints, external third-party APIs, paid metered endpoints, or shared staging databases.
- Never silently provision paid cloud services, external caches, or queues during an Unslop pass; propose infrastructure additions as explicit recommendations when local query/schema/concurrency fixes are insufficient.
- When safe local benchmarking is blocked (e.g., missing database engine or proprietary upstream data), record the lead as `needs_validation` with `severity: null` and provide a safe `safe_verification_recipe`.

## Reporting Vulnerabilities in This Repository
If you find a path-traversal issue, command-injection risk, or validator bypass in `scan-slop.cjs`, `validate-workload-ledger.cjs`, `compare-benchmarks.cjs`, or `validate-findings.cjs`, please open a GitHub Security Advisory on `Treamyracle/unslop-backend` before filing a public issue.
