# Spec: Test Infrastructure

**Change:** migrate-to-postgres-prisma
**Capability:** Integration test setup and execution against Postgres
**RFC 2119 keywords apply throughout.**

---

## Summary

The backend test suite currently runs against a Docker MySQL container (port 3307) with transactional rollback isolation. After migration, tests MUST run against a Docker Postgres container. The test bootstrap MUST use `prisma migrate deploy` to provision the schema. All ~50 existing test files MUST pass against Postgres (with MySQL-specific helpers removed or replaced).

---

## Requirements

### R1 — Real Postgres for integration tests

- Integration tests MUST run against a real Postgres instance, NOT against mocks or in-memory substitutes.
- The test Postgres instance MUST be isolated from any staging or production database.
- The test instance MUST be disposable: it MAY be torn down and recreated between full test runs.

### R2 — Docker Postgres in test setup

- The `npm run test:mysql:up` command MUST be replaced (or supplemented) with a `npm run test:postgres:up` command that starts a Docker Postgres container on a port distinct from any production port (SHOULD use port 5433 to avoid collision with local Postgres on 5432).
- The corresponding `npm run test:postgres:down` command MUST stop and remove the container.
- The Docker image MUST be a supported Postgres version consistent with Supabase's managed Postgres version (SHOULD be Postgres 15 or 16).

### R3 — Schema provisioned via Prisma

- The test setup script MUST run `prisma migrate deploy` against the test container before tests execute.
- Tests MUST NOT call `backend-schema.ts` or any runtime DDL function to set up the schema.
- If a test needs a table that does not exist in the migration, that table MUST be added to `prisma/schema.prisma` and a migration created — not created ad-hoc in the test.

### R4 — Transactional rollback isolation preserved

- Each test MUST continue to use transactional rollback isolation: begin a transaction before the test, roll it back after, so tests are independent and leave no residual data.
- The rollback pattern MUST work with Prisma's transaction API (not raw `mysql2` connections).

### R5 — All existing tests must pass

- All ~50 test files in `backend/` MUST pass against Postgres after migration.
- MySQL-specific SQL helpers (e.g. `` mysql2`raw query` `` wrappers, `mysql2` connection factories) MUST be removed from test utilities and replaced with Prisma-compatible equivalents.
- Tests that rely on MySQL-specific behavior (e.g. case-insensitive string comparison, TINYINT booleans, `ON UPDATE CURRENT_TIMESTAMP`) MUST be updated to match Postgres behavior.
- Test count MUST NOT decrease as a result of the migration (no test deletion to make the suite pass).

### R6 — Test environment variables

- Tests MUST use a dedicated `DATABASE_URL` pointing to the test container (e.g. `postgresql://test:test@localhost:5433/ticketera_test`).
- The test `DATABASE_URL` MUST be set via a `.env.test` file or environment variable injection, NOT hardcoded in test files.
- Tests MUST NOT accidentally connect to a production or staging database.

### R7 — CI runner compatibility

- The test setup (Docker Postgres + `prisma migrate deploy` + `npm test`) MUST work in a standard CI environment (GitHub Actions or equivalent) without manual intervention.
- The CI job MUST start the Docker container, wait for it to be healthy, run migrations, and then run tests — in that order.

---

## Scenarios

### Scenario 1 — `npm test` from a clean repo

```
Given a developer has cloned the repo
  And Docker is running
  And no test container exists
When the developer runs `npm run test:postgres:up`
Then a Docker Postgres container starts on port 5433
  And the container is healthy within 30 seconds
When the developer then runs `npm test`
Then `prisma migrate deploy` runs against the test container
  And all migrations apply successfully
  And all ~50 test files execute
  And all tests pass
  And no test leaves residual data (rollback isolation verified by re-running the suite)
```

### Scenario 2 — CI runner end-to-end

```
Given a CI pipeline triggered by a pull request
When the pipeline executes the test job
Then the job starts a Docker Postgres service (port 5433)
  And waits for the healthcheck to pass
  And runs `prisma migrate deploy` with the test DATABASE_URL
  And runs `npm test`
  And all tests pass
  And the pipeline reports success
When any test fails
Then the pipeline reports failure with the failing test name and error message
  And the Docker container is stopped after the job (pass or fail)
```

### Scenario 3 — Test isolation (rollback)

```
Given test A inserts a row into `eventos` inside a transaction
  And the test asserts the row exists
When test A completes (regardless of pass/fail)
Then the transaction is rolled back
  And the row is NOT visible to test B
When test B queries `eventos`
Then test B sees the same baseline data as if test A never ran
```

### Scenario 4 — MySQL-specific helper removed

```
Given a test utility that previously used mysql2 connection factory
When the test suite runs after migration
Then the utility uses the Prisma client (or a Prisma-compatible helper)
  And no `mysql2` import exists in the test directory
  And the test that used the utility passes
```

### Scenario 5 — Schema missing from migration fails loudly

```
Given a test that tries to insert into a table `foo`
  And `foo` is not in any migration (was created ad-hoc in old test setup)
When the test runs
Then the test fails with a clear "table does not exist" or Prisma type error
  AND the error is NOT silently swallowed by a CREATE TABLE fallback
  AND the developer knows they must add `foo` to schema.prisma and create a migration
```

---

## Out of Scope

- Frontend test infrastructure (minimal coverage, not in scope for this change).
- Performance benchmarks or load tests (separate concern).
- Test data factories or fixture libraries (implementation choice, design/apply phases).
