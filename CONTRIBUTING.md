# Contributing to `unslop-backend`

Contributions that improve runtime slop detection, query-plan playbooks, static lead accuracy, benchmark gate checks, or cross-agent compatibility are welcome.

## Design Principles
1. **Zero external runtime dependencies** across `skills/unslop-backend/*.cjs`, `scripts/check-repo.cjs`, `examples/sloppy-saas-api/`, and `examples/case-studies/` (Node.js `>= 22.5.0` built-ins including `node:sqlite` only).
2. **Measure before claiming**: Every playbook and optimization strategy must tie back to observable telemetry (query count, rows scanned, internal bytes read, payload bytes, latency percentiles, heap delta) and **exact golden output SHA-256 parity**.
3. **Skeptical verification**: Never relax `compare-benchmarks.cjs` or `validate-findings.cjs` to allow unverified wins, cold-vs-warm comparisons, or silent API contract drift.
4. **Honest documentation**: Update `docs/STATUS.md` strictly with commands and test counts you directly ran and observed.

## Local Checks
Run the full test, benchmark, sample validation, and repo integrity suite:

```bash
npm test
```

Or run individual checks:

```bash
npm run test:validators
npm run test:benchmarks
npm run validate:sample
npm run check:repo
```
