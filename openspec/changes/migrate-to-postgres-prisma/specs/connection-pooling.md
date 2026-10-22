# Spec: Connection Pooling

**Change:** migrate-to-postgres-prisma
**Capability:** Database connection management for runtime queries and migrations
**RFC 2119 keywords apply throughout.**

---

## Summary

Supabase provides two connection endpoints: a PgBouncer pooler in transaction mode (port 6543) for runtime queries, and a direct Postgres connection (port 5432) for operations incompatible with pooling. After migration, the application MUST route queries to the correct endpoint. Runtime queries MUST use the pooler for scalability. Migrations, advisory locks, and session-scoped state MUST use the direct connection.

---

## Background

PgBouncer in transaction mode reuses connections across requests but does NOT preserve session state between transactions. This breaks:

- `SELECT pg_advisory_lock(...)` — advisory locks are session-scoped
- `SET LOCAL` / `SET` — session variables reset between transactions
- `PREPARE` / `EXECUTE` — prepared statements are session-scoped
- `LISTEN`/`NOTIFY` with persistent subscription — session-scoped
- DDL in `prisma migrate deploy` — some DDL requires a non-pooled connection

---

## Requirements

### R1 — Pooler for runtime queries

- The Prisma client used for business logic queries MUST connect via the Supabase PgBouncer pooler (port 6543, transaction mode).
- `DATABASE_URL` MUST point to the pooler endpoint (e.g. `postgresql://user:pass@db.project.supabase.co:6543/postgres?pgbouncer=true`).
- The `?pgbouncer=true` query parameter MUST be present in `DATABASE_URL` to disable Prisma's prepared statement caching, which is incompatible with PgBouncer transaction mode.

### R2 — Direct connection for migrations

- `prisma migrate deploy` MUST use the direct Postgres connection (port 5432).
- `DIRECT_URL` MUST be set in environment and referenced in `prisma/schema.prisma` via the `directUrl` datasource property.
- The deploy pipeline MUST use `DIRECT_URL` (or configure Prisma to use it automatically via `directUrl`).

### R3 — Direct connection for advisory locks and session-scoped operations

- Any code that uses advisory locks (e.g. `pg_advisory_lock`, `pg_advisory_xact_lock`) MUST use the direct connection, NOT the pooler.
- Any code that sets session-level variables (`SET`) or relies on session state MUST use the direct connection.
- The design phase MUST enumerate all such sites in the codebase and document how each routes to the direct connection.

### R4 — Long-running transactions use direct connection

- Transactions that are expected to hold locks for more than a few hundred milliseconds (e.g. large refund batch operations, stock reconciliation jobs) SHOULD use the direct connection to avoid holding a pooled connection slot for an extended period.

### R5 — Connection limit awareness

- The application MUST NOT open more Prisma client instances than needed (one per process is the default).
- The Prisma client connection pool size MUST be configured explicitly for each deployment context (backend, frontend, jobs) to avoid saturating the Supabase connection limit.
- The recommended pool sizes MUST be documented in `.env.example` comments or equivalent.

### R6 — No hardcoded ports or hostnames

- Connection strings MUST come exclusively from environment variables.
- No Postgres port number (5432, 6543) or Supabase hostname MUST appear as a hardcoded literal in application source code.

---

## Scenarios

### Scenario 1 — High-traffic checkout (pooler path)

```
Given 100 concurrent checkout creation requests
  And DATABASE_URL points to the pooler (port 6543)
  And the Prisma client is configured with ?pgbouncer=true
When all 100 requests execute their checkout transactions
Then each transaction acquires a connection from the pool for its duration
  And returns the connection to the pool on commit or rollback
  And no "too many connections" error occurs at the Postgres level
  And the stock locking strategy works correctly under pooled connections
    (i.e. lock sites use direct connection or an advisory-lock-free strategy)
```

### Scenario 2 — Migration deploy (direct connection path)

```
Given DIRECT_URL points to port 5432 (direct Postgres)
  And DATABASE_URL points to port 6543 (pooler)
When the CI/CD pipeline runs `prisma migrate deploy`
Then Prisma uses DIRECT_URL for the migration connection
  And DDL statements execute without PgBouncer interference
  And the migration completes successfully
  And the `_prisma_migrations` table is updated correctly
```

### Scenario 3 — Advisory lock via direct connection

```
Given a backend operation that requires an advisory lock to prevent concurrent processing
  And the operation is implemented using a direct connection (not the pooler)
When the operation runs
Then the advisory lock is acquired on the direct connection
  And the lock is held for the duration of the operation
  And the lock is released when the direct connection transaction ends
  And the pooler connection pool is NOT affected by this lock
```

### Scenario 4 — Refund job with long-running transaction

```
Given a scheduled refund reconciliation job that processes 500 refunds in a single transaction
  And the job is configured to use the direct connection
When the job runs
Then it holds the direct connection for the transaction duration
  And the pooler's connection slots remain available for concurrent user requests
  And the job completes without a "connection reset by peer" or pool timeout error
```

### Scenario 5 — Misconfigured DATABASE_URL (pooler without pgbouncer=true)

```
Given DATABASE_URL is set to the pooler endpoint but WITHOUT ?pgbouncer=true
When the application makes its first Prisma query that uses prepared statements
Then a PgBouncer-related error occurs (e.g. "prepared statement already exists")
  AND the error is surfaced clearly in the application logs
  AND the cause is diagnosable from the error message
```

---

## Out of Scope

- PgBouncer configuration on the Supabase side (managed by Supabase, not the application).
- Read replicas or multi-region routing (not in scope for this change).
- Connection string rotation or secrets management (ops concern, not application logic).
