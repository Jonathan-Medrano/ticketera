# Spec: Schema and Migrations

**Change:** migrate-to-postgres-prisma
**Capability:** Schema versioning, migration lifecycle, and seed data
**RFC 2119 keywords apply throughout.**

---

## Summary

After migration, `prisma/migrations/` is the single versioned history of all schema changes. No code path creates or alters tables at runtime. `prisma migrate deploy` is the exclusive mechanism for evolving the schema in all environments. Seed data is managed via `prisma db seed`.

---

## Requirements

### R1 — Versioned migrations

- All schema changes MUST be represented as migration files under `prisma/migrations/`, named with a timestamp prefix and a descriptive slug (e.g. `20260601120000_initial_schema`).
- Migration files MUST be committed to source control.
- Migration files MUST be treated as immutable once committed — no editing of already-applied migrations.
- When a past migration needs correction, a new additive or corrective migration MUST be created.

### R2 — Migration deploy before app start

- In every environment (staging, production), `prisma migrate deploy` MUST run and complete successfully before the application process starts.
- The deployment pipeline MUST be ordered: migrate → then start app. Starting the app before migrations complete is NOT permitted.
- `prisma migrate deploy` MUST use the `DIRECT_URL` connection (port 5432), not the pooler, to avoid pgBouncer transaction mode incompatibility with migration DDL.

### R3 — No runtime schema modification

- The application MUST NOT execute `CREATE TABLE`, `ALTER TABLE`, `DROP TABLE`, `CREATE INDEX`, or any other DDL at runtime.
- Startup schema-check code (the current `backend-schema.ts` pattern) MUST be completely removed.
- The frontend (`platea/`) MUST NOT execute DDL in any route handler, middleware, or library initialization.

### R4 — Seed data management

- Demo data, test fixtures, and initial lookup data MUST be managed via `prisma db seed`.
- The seed script MUST be idempotent: running it multiple times MUST NOT create duplicate records.
- The existing `npm run seed:superadmin-demo` command MUST be preserved or superseded by `prisma db seed` with equivalent functionality.

### R5 — Migration rollback strategy

- Because Postgres does not support transactional DDL for all operations (e.g. adding an index `CONCURRENTLY`), the migration rollback strategy MUST be documented in the design phase.
- For the initial migration (big-bang, no production data), rollback means re-creating the database from scratch.
- For subsequent migrations in production, each migration that is not fully reversible MUST include a companion "down" migration documented in comments or as a separate file.

### R6 — Schema drift detection

- `prisma migrate status` SHOULD be run in CI after deploy to verify the database schema matches the expected migration state.
- A schema drift (database state differs from migration history) MUST be treated as a deploy failure.

---

## Scenarios

### Scenario 1 — Fresh environment provisioning

```
Given a brand-new Postgres database with no tables
  And DIRECT_URL and DATABASE_URL are set correctly
When a developer runs `prisma migrate deploy`
Then all migrations execute in chronological order
  And all tables, columns, indexes, and constraints are created
  And the `_prisma_migrations` tracking table reflects each migration as applied
  And the command exits with code 0
When the developer then starts the application
Then the app starts successfully without attempting any DDL
  And all API endpoints respond normally
```

### Scenario 2 — Schema evolution (add a new column)

```
Given a running production environment on migration version N
  And a developer has created migration N+1 that adds column `new_col` to table `eventos`
When the CI/CD pipeline runs `prisma migrate deploy` before deploying app version N+1
Then migration N+1 is applied and `new_col` exists in the database
  And existing rows have the default value or NULL for `new_col`
  And the previous app version (N) continues to work (forward-compatible migration)
When the new app version N+1 starts
Then it reads and writes `new_col` via the Prisma client without error
```

### Scenario 3 — Migration with syntax error fails deployment

```
Given a migration file with a SQL syntax error committed to the branch
When the CI/CD pipeline runs `prisma migrate deploy`
Then the command fails with a non-zero exit code
  And the error message identifies the failing migration file
  And the application deployment step does NOT execute
  And the database remains at the prior migration version (no partial apply)
```

### Scenario 4 — Seed idempotency

```
Given the application database is fully migrated
When a developer runs `prisma db seed` for the first time
Then the super-admin demo user is created
  And initial lookup data is inserted
When the developer runs `prisma db seed` again
Then no duplicate records are created
  And the command exits with code 0
```

### Scenario 5 — CI migration status check

```
Given the application is deployed to staging
  And `prisma migrate deploy` has run
When the CI step runs `prisma migrate status`
Then the output reports all migrations as applied
  And no pending or failed migrations exist
  And the step exits with code 0
When a migration was manually rolled back or skipped
Then `prisma migrate status` reports a drift
  And the CI step exits with a non-zero code
```

---

## Out of Scope

- The specific SQL content of each migration (generated from `prisma/schema.prisma` during apply phase).
- Advisory lock handling during concurrent migration deploys (Prisma handles this natively).
- Blue-green deployment strategies (not in scope for this change).
