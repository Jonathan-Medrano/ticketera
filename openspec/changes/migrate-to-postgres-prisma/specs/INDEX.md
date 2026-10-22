# Spec Index — migrate-to-postgres-prisma

**Change:** migrate-to-postgres-prisma
**Phase:** spec
**Date:** 2026-06-01

This index lists all delta spec files for the Postgres/Prisma migration. Each file specifies WHAT must be true after the migration for its capability area — not HOW it is implemented (that is the design phase).

---

## Spec Files

| File | Capability | Key Constraint |
|------|------------|----------------|
| [data-access-layer.md](data-access-layer.md) | All DB access through Prisma; no mysql2; no runtime DDL | R1: zero mysql2 imports; R2: schema.prisma is sole source of truth |
| [stock-locking.md](stock-locking.md) | Concurrency control for ticket and consumable stock | R1: no oversell under 50 concurrent buyers; R2: consistent lock strategy across 42 sites |
| [transactions-and-isolation.md](transactions-and-isolation.md) | Transactional integrity for multi-statement operations | R1: all known transaction boundaries remain atomic; R4: retry wrapper for serialization failures |
| [schema-and-migrations.md](schema-and-migrations.md) | Schema versioning and migration lifecycle | R1: versioned in prisma/migrations/; R2: migrate deploy before app start; R3: no runtime DDL |
| [frontend-db-access.md](frontend-db-access.md) | Database access from platea/ (Next.js) | R1: no mysql2 in frontend; R2: no DDL in password-version.ts or route-rate-limit.ts |
| [test-infrastructure.md](test-infrastructure.md) | Integration tests against real Postgres | R2: Docker Postgres replaces Docker MySQL; R5: all ~50 tests pass |
| [case-sensitivity-and-data-types.md](case-sensitivity-and-data-types.md) | String comparisons, booleans, timestamps, updated_at | R1: explicit case normalization for slug/email/code; R3: updated_at auto-updates; R4: TIMESTAMPTZ |
| [connection-pooling.md](connection-pooling.md) | Pooler vs direct connection routing | R1: pooler (6543) for runtime; R2: direct (5432) for migrations; R3: direct for advisory locks |

---

## Critical Constraints (summary across all specs)

1. **No mysql2 anywhere** — both backend/ and platea/ (data-access-layer, frontend-db-access)
2. **No runtime DDL** — backend-schema.ts deleted, password-version.ts and route-rate-limit.ts refactored (data-access-layer, schema-and-migrations, frontend-db-access)
3. **42 FOR UPDATE sites** — all must be migrated to one consistent Postgres-compatible strategy (stock-locking)
4. **36 transaction sites** — isolation level audit required; READ COMMITTED default; Serializable only where needed (transactions-and-isolation)
5. **~20 updated_at columns** — ON UPDATE CURRENT_TIMESTAMP has no Postgres equivalent; requires Prisma @updatedAt or trigger (case-sensitivity-and-data-types)
6. **Case sensitivity** — slug/email/code lookups must normalize case (case-sensitivity-and-data-types)
7. **?pgbouncer=true** — required in DATABASE_URL or Prisma prepared statements break (connection-pooling)
8. **DIRECT_URL required** — for migrate deploy and advisory lock sites (connection-pooling, schema-and-migrations)

---

## Dependencies

- Spec is input to: **design** and **tasks** phases
- Tasks MUST NOT start until both **spec** and **design** phases are complete
- Design phase MUST resolve: FOR UPDATE replacement strategy, updated_at mechanism, isolation audit table, CITEXT vs application-level case normalization
