# Spec: Data Access Layer

**Change:** migrate-to-postgres-prisma
**Capability:** All database access in the application
**RFC 2119 keywords apply throughout.**

---

## Summary

After this migration, every database interaction in the backend and frontend MUST go through the Prisma client. The `mysql2` driver, all runtime DDL (`backend-schema.ts`, `password-version.ts`, `route-rate-limit.ts`), and any ad-hoc driver usage are REMOVED. `prisma/schema.prisma` becomes the sole schema source of truth.

---

## Requirements

### R1 — Single data access path

- The application MUST NOT import `mysql2`, `mysql2/promise`, or any raw Postgres driver (`pg`, `postgres`) for business queries.
- The ONLY permitted exception is `prisma.$queryRaw` / `prisma.$executeRaw` for queries that Prisma's query builder cannot express (e.g. advisory locks, `SELECT FOR UPDATE SKIP LOCKED`).
- All raw SQL via `$queryRaw` MUST be tagged template literals using `Prisma.sql` to prevent SQL injection.

### R2 — Schema source of truth

- `prisma/schema.prisma` MUST be the single authoritative schema definition for ALL tables, columns, indexes, and constraints.
- `backend/src/lib/backend-schema.ts` MUST be deleted; its runtime `ALTER TABLE` statements MUST be replaced by Prisma migrations.
- `platea/lib/password-version.ts` MUST NOT execute DDL; the `password_versions` table MUST be declared in `prisma/schema.prisma`.
- `platea/lib/route-rate-limit.ts` MUST NOT execute DDL; the rate-limit storage table MUST be declared in `prisma/schema.prisma`.

### R3 — No runtime DDL

- The application MUST NOT execute `CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, or any DDL statement at application startup or request time.
- All schema evolution MUST happen through `prisma migrate` commands run outside the application process (CI/CD pipeline or manual ops).

### R4 — Prisma client generation

- The Prisma client MUST be generated from `prisma/schema.prisma` before the application starts (e.g. `prisma generate` as a `postinstall` script).
- Both `backend/` and `platea/` MUST use typed Prisma client instances backed by the same `schema.prisma`.

### R5 — Connection configuration

- Database connection strings MUST come from environment variables only (`DATABASE_URL`, `DIRECT_URL`).
- The application MUST NOT hardcode host, port, user, password, or database name.

---

## Scenarios

### Scenario 1 — Clean application startup

```
Given a correctly provisioned Postgres database
  And all Prisma migrations have been applied
  And DATABASE_URL points to the pooler (port 6543)
  And DIRECT_URL points to the direct connection (port 5432)
When the backend process starts
Then the Prisma client connects successfully
  And no DDL statements are executed
  And no mysql2 or pg driver is imported
  And the application is ready to serve requests within 5 seconds
```

### Scenario 2 — Fresh database (zero migrations applied)

```
Given a Postgres instance with no application tables
When a developer runs `prisma migrate deploy`
Then all migrations execute in order
  And the final schema matches prisma/schema.prisma exactly
  And the command exits with code 0
When the application then starts
Then it connects and serves requests normally
  And no runtime DDL is attempted
```

### Scenario 3 — Migration deploy in CI/CD

```
Given a CI pipeline that runs before app deployment
When the pipeline executes `prisma migrate deploy`
Then any pending migrations are applied atomically
  And already-applied migrations are skipped without error
  And on success the pipeline proceeds to deploy the application
When a migration contains a syntax error
Then the pipeline exits with a non-zero code
  And the application deployment does NOT proceed
```

### Scenario 4 — Developer adds a new column

```
Given a developer who needs to add column X to table Y
When the developer runs `prisma migrate dev --name add-X-to-Y`
Then a new migration file is created in prisma/migrations/
  And the migration file contains only the ALTER TABLE statement for column X
  And prisma/schema.prisma is updated to reflect column X
  And no code in backend/ or platea/ creates the column at runtime
```

---

## Out of Scope

- The specific Prisma schema syntax for each table (that is the design phase).
- The connection pooling strategy (see `connection-pooling.md`).
- Test database provisioning (see `test-infrastructure.md`).
