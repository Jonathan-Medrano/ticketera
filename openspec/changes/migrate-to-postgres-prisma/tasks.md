# Tasks: Migrate to Postgres + Prisma

**Change**: migrate-to-postgres-prisma
**Status**: ready for sdd-apply
**Timeline**: 4-6 weeks across 4 phases
**Last updated**: 2026-06-01

---

## Phase 1 — Foundation (week 1)

### 1.1 Supabase project setup
- [ ] 1.1.1 Create Supabase project; note URL, service role key, and project ref
- [ ] 1.1.2 Configure connection strings: `DATABASE_URL` (PgBouncer pooler port 6543 with `?pgbouncer=true&connection_limit=1`), `DIRECT_URL` (direct port 5432)
- [ ] 1.1.3 Add both URLs to `.env.example` (both apps) and `SECRETS-GENERADOS.txt`
- [ ] 1.1.4 Verify both connections work with `psql $DATABASE_URL` and `psql $DIRECT_URL`

**Done when**: both `psql` commands succeed; `.env.example` has both keys.

### 1.2 Prisma initialization
- [ ] 1.2.1 Add `prisma` (dev dep) and `@prisma/client` to `backend/package.json`
- [ ] 1.2.2 Add `prisma` (dev dep) and `@prisma/client` to `platea/package.json`
- [ ] 1.2.3 Set `"prisma": { "schema": "../prisma/schema.prisma" }` in both `package.json` files
- [ ] 1.2.4 Create `prisma/schema.prisma` at repo root with `datasource db` (DATABASE_URL + directUrl = DIRECT_URL) and `generator client`
- [ ] 1.2.5 Verify `npx prisma generate` succeeds from both `backend/` and `platea/`

**Done when**: `prisma generate` runs without error from both app directories.

### 1.3 Translate schema (`backend-schema.ts` → `schema.prisma`)
- [ ] 1.3.1 Inventory all tables in `backend/src/lib/backend-schema.ts`; produce a list with column counts
- [ ] 1.3.2 Translate each domain group to Prisma models:
  - [ ] 1.3.2.1 **Auth**: `usuarios`, `sessions`, password reset tables, `password_versions`
  - [ ] 1.3.2.2 **Roles/RBAC**: `usuarios_roles`, `usuarios_permisos`, `roles`, `permisos`
  - [ ] 1.3.2.3 **Eventos**: `eventos`, `eventos_fechas`, `eventos_tandas`, `entrada_categorias`
  - [ ] 1.3.2.4 **Checkout + entradas**: `checkout_sessions`, `entradas`, `qr_codes`
  - [ ] 1.3.2.5 **Consumibles**: `barras`, `barra_stock`, `consumibles`, `consumibles_ventas`, `consumibles_canje`
  - [ ] 1.3.2.6 **Marketing**: `campanas`, `email_logs`, `contactos`, `unsubscribes`, `google_oauth_tokens`
  - [ ] 1.3.2.7 **Platform**: `empresas`, `platform_payment_accounts`, `marketplace_fees`
  - [ ] 1.3.2.8 **Misc**: `rate_limits`, `revendedores`, `ventas_velocity_snapshots`, `audit_logs` (if present)
- [ ] 1.3.3 Apply schema modeling decisions for each model:
  - `INT` autoincrement → `@default(autoincrement())`
  - `JSON` columns → `Json @db.JsonB`
  - Money/decimal columns → `@db.Decimal(12, 2)` (never `Float`)
  - All timestamps → `DateTime @db.Timestamptz`
  - `created_at` → `@default(now()) @db.Timestamptz`
  - `updated_at` → `@updatedAt @db.Timestamptz` (informational; trigger is source of truth)
  - MySQL `TINYINT(1)` booleans → `Boolean`
  - MySQL `ENUM` columns → Prisma `enum` block (13 enums total; list each)
  - `deleted_at` soft-delete columns → add partial index `WHERE deleted_at IS NULL`
- [ ] 1.3.4 Translate all unique constraints, composite indexes, and explicit FK relations
- [ ] 1.3.5 Add `@@map("table_name")` to every model to preserve existing table names
- [ ] 1.3.6 Replace all `=== 1` / `=== 0` boolean checks in TypeScript with `=== true` / `=== false`
- [ ] 1.3.7 Run `npx prisma validate` — zero errors

**Done when**: `prisma validate` exits 0; all tables from 1.3.1 inventory are represented.

### 1.4 Initial migration
- [ ] 1.4.1 Run `npx prisma migrate dev --name init` against the Supabase dev DB
- [ ] 1.4.2 Verify migration runs clean: no errors in Supabase dashboard `Table Editor`
- [ ] 1.4.3 Run `npx prisma migrate deploy` against the same DB (smoke test CI path)
- [ ] 1.4.4 Commit `prisma/migrations/` to git

**Done when**: `prisma migrate deploy` exits 0 against a fresh Supabase DB.

### 1.5 `set_updated_at()` Postgres triggers
- [ ] 1.5.1 Create migration `add-updated-at-triggers` with shared PL/pgSQL function:
  ```sql
  CREATE OR REPLACE FUNCTION set_updated_at()
  RETURNS TRIGGER AS $$
  BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
  $$ LANGUAGE plpgsql;
  ```
- [ ] 1.5.2 List all ~20 tables that have an `updated_at` column (extract from schema.prisma)
- [ ] 1.5.3 Add one `CREATE TRIGGER trg_set_updated_at_<table>` per table in the migration
- [ ] 1.5.4 Integration test: UPDATE a row via `$queryRaw`, verify `updated_at` changed

**Done when**: trigger function deployed; integration test green; all ~20 tables covered.

### 1.6 Two-client Prisma architecture
- [ ] 1.6.1 Create `backend/src/lib/prisma.ts` exporting `prisma` (DATABASE_URL pooler) and `prismaDirectUrl` (DIRECT_URL direct)
- [ ] 1.6.2 Create `platea/lib/prisma.ts` exporting `prisma` (DATABASE_URL pooler only — no direct client)
- [ ] 1.6.3 Add SIGTERM graceful shutdown handler in `backend/src/index.ts` disconnecting both clients
- [ ] 1.6.4 Add ESLint `no-restricted-imports` rule: `prismaDirectUrl` must not be imported in `platea/`

**Done when**: both files compile; SIGTERM handler present; ESLint rule active.

### 1.7 Error mapping middleware
- [ ] 1.7.1 Add `isPrismaError(err)` utility in `backend/src/lib/prisma-errors.ts`
- [ ] 1.7.2 Map: P2002 → 409, P2003 → 400, P2025 → 404
- [ ] 1.7.3 Map: P2034 → retry (max 3, backoff 50ms) then 503
- [ ] 1.7.4 Wire into Express error middleware in `backend/src/index.ts`
- [ ] 1.7.5 Unit test: assert each error code produces the correct HTTP status

**Done when**: unit tests green; middleware wired.

### 1.8 Retry wrapper for SERIALIZABLE transactions
- [ ] 1.8.1 Create `backend/src/lib/with-serializable.ts`: async wrapper that catches P2034 and retries (max 3, initial delay 50ms, exponential backoff)
- [ ] 1.8.2 Unit test: mock P2034 twice → succeeds on third attempt; mock P2034 three times → throws 503
- [ ] 1.8.3 Export `withSerializable(prismaClient, fn)` — accepts either `prisma` or `prismaDirectUrl`

**Done when**: unit tests green; wrapper exported and typed.

### 1.9 Seed setup
- [ ] 1.9.1 Add `"prisma": { "seed": "tsx prisma/seed.ts" }` to `backend/package.json`
- [ ] 1.9.2 Create `prisma/seed.ts`; port `backend/scripts/seed-superadmin-demo.ts` to use Prisma client
- [ ] 1.9.3 Verify `npx prisma db seed` runs after `prisma migrate dev` on fresh DB

**Done when**: `prisma db seed` exits 0; super-admin row visible in Supabase Table Editor.

**Phase 1 acceptance**: `prisma migrate deploy` succeeds on fresh DB; seed runs; both Prisma clients connect; `set_updated_at` triggers deployed; error middleware and retry wrapper exist with tests.

---

## Phase 2 — Hot path (weeks 2-3)

> All migrations in this phase: remove raw mysql2 queries, replace with Prisma. FOR UPDATE sites use `prismaDirectUrl.$transaction` + `$queryRaw ... FOR UPDATE`. Verify with tests at end of each task group.

### 2.1 Auth module
- [ ] 2.1.1 Translate all queries in `backend/src/routes/auth.ts` to Prisma client (no mysql2)
- [ ] 2.1.2 Translate `backend/src/lib/password-reset.ts` to Prisma
- [ ] 2.1.3 Remove `ALTER TABLE` DDL from `platea/lib/password-version.ts`; column already in schema.prisma (1.3); rewrite access as `prisma.usuario.findUnique()`
- [ ] 2.1.4 Translate auth-related queries in `backend/src/middleware/auth.ts`
- [ ] 2.1.5 Run existing auth tests against Postgres; fix any assertion mismatches

**Done when**: no mysql2 in auth module; auth tests green.

### 2.2 Checkout core (CRITICAL — stock locking)
- [ ] 2.2.1 Identify all 8–9 FOR UPDATE sites in `backend/src/routes/tenant.ts` (checkout flow); add inline comments `// LOCK SITE #N`
- [ ] 2.2.2 Wrap each in `prismaDirectUrl.$transaction(async (tx) => { ... }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })` + apply `withSerializable`
- [ ] 2.2.3 Translate `$queryRaw SELECT ... FROM entrada_categorias FOR UPDATE` + stock decrement `UPDATE`
- [ ] 2.2.4 Translate `$queryRaw SELECT ... FROM barra_stock FOR UPDATE` + stock decrement
- [ ] 2.2.5 Translate `checkout_sessions` upsert (was MySQL `INSERT ... ON DUPLICATE KEY UPDATE`) → Prisma `upsert` inside the same transaction
- [ ] 2.2.6 Translate cleanup logic in `expiredCheckoutCleanupJob.ts` to Prisma (no FOR UPDATE needed here)
- [ ] 2.2.7 **Concurrency test** (acceptance gate): 50 goroutines (or Node workers) attempt to buy the last 1 unit of `entrada_categoria` simultaneously → assert exactly 1 success + `stock_disponible = 0`

**Done when**: concurrency test green; no mysql2 in checkout path.

### 2.3 Payment webhook + confirmation
- [ ] 2.3.1 Translate MP webhook handler in `backend/src/routes/tenant.ts` to Prisma
- [ ] 2.3.2 Translate `confirmarPagoLogic()` (and any extracted helpers) to Prisma; use `prismaDirectUrl` + SERIALIZABLE for the confirmation transaction
- [ ] 2.3.3 Translate idempotency check: `checkout_sessions` state machine (`pendiente` → `confirmado`); ensure double-processing is impossible
- [ ] 2.3.4 **Idempotency test**: POST same webhook payload twice → assert exactly 1 set of `entradas` rows created; second call is a no-op

**Done when**: idempotency test green; no mysql2 in webhook path.

### 2.4 Refund flow (heaviest FOR UPDATE concentration)
- [ ] 2.4.1 List all 20 FOR UPDATE sites in `backend/src/lib/refund-manual.ts`; add inline comments `// LOCK SITE #N`
- [ ] 2.4.2 Translate each to `prismaDirectUrl.$queryRaw ... FOR UPDATE` preserving nested transaction boundaries
- [ ] 2.4.3 Apply SERIALIZABLE isolation + `withSerializable` to the outer refund transaction
- [ ] 2.4.4 Translate all non-lock queries in the file to Prisma client
- [ ] 2.4.5 Partial refund concurrency test: two concurrent partial refund requests on same checkout → assert correct stock restoration, no double-refund

**Done when**: concurrency test green; no mysql2 in refund-manual.ts.

### 2.5 Consumibles hot path
- [ ] 2.5.1 Translate FOR UPDATE sites in `consumibles.ts` / `consumibles-sales.ts` / `consumibles-redeem.ts` (5 sites) to Strategy A (`prismaDirectUrl.$queryRaw FOR UPDATE`, SERIALIZABLE)
- [ ] 2.5.2 Translate FOR UPDATE site in `vender.ts` (1 site) to Strategy A
- [ ] 2.5.3 Translate remaining non-lock queries in these files to Prisma client
- [ ] 2.5.4 Verify consumable stock decrement test: simultaneous sale of last 1 unit → exactly 1 success

**Done when**: stock test green; no mysql2 in consumibles hot path.

### 2.6 Rate limiting (Strategy B)
- [ ] 2.6.1 Rewrite `backend/src/lib/persistent-rate-limit.ts` — remove mysql2 FOR UPDATE; implement as Prisma `upsert` inside SERIALIZABLE transaction using `prisma` (pooler, not direct)
- [ ] 2.6.2 Remove `CREATE TABLE IF NOT EXISTS` DDL from `platea/lib/route-rate-limit.ts`; table already in schema.prisma; rewrite counter logic as Prisma `upsert` with `withSerializable`
- [ ] 2.6.3 Test: call rate limit check 60× in under 1 minute with the same key → 60th call is rejected

**Done when**: rate limit tests green; no DDL or mysql2 in either file.

### 2.7 Buyer settings
- [ ] 2.7.1 Translate FOR UPDATE sites in `buyer-settings-service.ts` (3 sites) to Strategy B (`prisma.$transaction` SERIALIZABLE via `withSerializable`)
- [ ] 2.7.2 Translate remaining queries to Prisma client

**Done when**: no mysql2; no direct-client usage in buyer-settings.

### 2.8 Tenant routing + branding
- [ ] 2.8.1 Translate tenant resolution queries (slug lookup) to Prisma; enforce `slug.toLowerCase()` before every lookup
- [ ] 2.8.2 Create migration `add-slug-email-lowercase-indexes`:
  - `UPDATE eventos SET slug = LOWER(slug)` data migration
  - `CREATE UNIQUE INDEX ON eventos (LOWER(slug))`
  - `UPDATE empresas SET slug = LOWER(slug)`
  - `CREATE UNIQUE INDEX ON empresas (LOWER(slug))`
  - `UPDATE usuarios SET email = LOWER(TRIM(email))`
  - `CREATE UNIQUE INDEX ON usuarios (LOWER(email))`
  - Same for `compradores.email`
- [ ] 2.8.3 Audit service layer: every write of `slug` or `email` must call `toLowerCase()` before Prisma insert/update
- [ ] 2.8.4 Case-sensitivity test: insert email `Test@Example.COM`, query `test@example.com` → found; insert slug `MiEvento`, query `mievento` → found
- [ ] 2.8.5 Translate branding/settings queries (empresa config, logo, colors) to Prisma

**Done when**: case-sensitivity test green; tenant routes return correct data from Postgres.

### 2.9 Frontend DB layer (platea/)
- [ ] 2.9.1 Translate all raw mysql2 queries in `platea/lib/db.ts` to Prisma client (`platea/lib/prisma.ts`)
- [ ] 2.9.2 Translate any SSR direct DB calls in `platea/app/` server components to Prisma
- [ ] 2.9.3 Verify `platea/` has zero mysql2 imports (`rg 'mysql2' platea/` → no output)

**Done when**: no mysql2 in platea/; frontend pages render with Postgres data.

**Phase 2 acceptance**: full checkout flow works E2E in Postgres; concurrency tests green (2.2.7, 2.4.5, 2.5.4); idempotency test green (2.3.4); case-sensitivity test green (2.8.4); no mysql2 imports in hot path.

---

## Phase 3 — Cold path (week 4)

### 3.1 Reports + KPIs — SQL dialect fixes
- [ ] 3.1.1 Find all `GROUP_CONCAT` usages (`rg 'GROUP_CONCAT' backend/`); translate each to `STRING_AGG(col, ',')` in `$queryRaw`
- [ ] 3.1.2 Find all `DATE_FORMAT` usages (`rg 'DATE_FORMAT' backend/`); translate to `TO_CHAR(col, 'format')` (MySQL → Postgres format mapping: `%Y-%m-%d` → `YYYY-MM-DD`, `%H:%i` → `HH24:MI`)
- [ ] 3.1.3 Find all `DATE_SUB` / `DATE_ADD` / `INTERVAL x DAY` usages; translate to Postgres `col - INTERVAL 'N days'`
- [ ] 3.1.4 Translate KPI aggregation queries in `routes/eventos.ts` (or relevant route) to Prisma / `$queryRaw`
- [ ] 3.1.5 Translate compare/velocity queries (dashboard graphs, trend lines) to Prisma / `$queryRaw`

**Done when**: no DATE_FORMAT, DATE_SUB, DATE_ADD, or GROUP_CONCAT in any `$queryRaw` call.

### 3.2 Exports (CSV/XLSX)
- [ ] 3.2.1 Translate export queries in `routes/compradores.ts` to Prisma / `$queryRaw`
- [ ] 3.2.2 Translate export queries in `routes/entradas.ts` to Prisma / `$queryRaw`
- [ ] 3.2.3 Translate export queries in `routes/revendedores.ts` to Prisma / `$queryRaw`
- [ ] 3.2.4 Translate export queries in `routes/ventas.ts` to Prisma / `$queryRaw`
- [ ] 3.2.5 Verify export files download with correct data against Postgres seed data

**Done when**: all 4 export routes generate valid CSV/XLSX from Postgres.

### 3.3 Jobs migration
- [ ] 3.3.1 Translate `marketingCarritoAbandonadoJob.ts` to Prisma (no mysql2)
- [ ] 3.3.2 Translate `salesVelocitySnapshotJob.ts` to Prisma (no mysql2)
- [ ] 3.3.3 Verify `expiredCheckoutCleanupJob.ts` (translated in 2.2.6) still correct
- [ ] 3.3.4 If delivery retry job uses advisory lock (`pg_advisory_xact_lock`): ensure it uses `prismaDirectUrl` (direct:5432 — advisory locks incompatible with PgBouncer transactional mode)

**Done when**: all 3 jobs run without error against Postgres in a manual trigger test.

### 3.4 Marketing (Resend + Gmail OAuth)
- [ ] 3.4.1 Translate queries in `routes/marketing.ts` to Prisma (no mysql2)
- [ ] 3.4.2 Translate queries in `lib/google-marketing-oauth.ts` to Prisma (no mysql2)
- [ ] 3.4.3 Verify email address lookups normalize case (lowercase on write, `WHERE LOWER(email) = $1` on read) in marketing send path

**Done when**: no mysql2 in marketing module; email normalization consistent.

### 3.5 Consumibles search — FULLTEXT replacement
- [ ] 3.5.1 Create migration `add-pg-trgm`:
  - `CREATE EXTENSION IF NOT EXISTS pg_trgm`
  - `CREATE INDEX idx_consumibles_nombre_trgm ON consumibles USING GIN (nombre gin_trgm_ops)`
  - `CREATE INDEX idx_consumibles_descripcion_trgm ON consumibles USING GIN (descripcion gin_trgm_ops)`
- [ ] 3.5.2 Find the 2 `MATCH ... AGAINST IN BOOLEAN MODE` sites in `consumibles.ts`; translate to `WHERE nombre ILIKE '%' || $1 || '%' OR descripcion ILIKE '%' || $1 || '%'`
- [ ] 3.5.3 Smoke test: search for partial consumable name → results match expected items

**Done when**: no MATCH/AGAINST in codebase; search returns correct results.

### 3.6 Super-admin module
- [ ] 3.6.1 Translate `routes/platform/empresas.ts` to Prisma (no mysql2)
- [ ] 3.6.2 Translate `routes/platform/cobros.ts` to Prisma (no mysql2)
- [ ] 3.6.3 Translate `lib/platform-payment-accounts.ts` to Prisma (no mysql2)
- [ ] 3.6.4 Verify super-admin list empresa + cobros views render in browser

**Done when**: no mysql2 in super-admin module; views render.

### 3.7 Roles / permissions
- [ ] 3.7.1 Translate `routes/roles.ts` to Prisma (no mysql2)
- [ ] 3.7.2 Translate `lib/authz.ts` to Prisma (no mysql2)
- [ ] 3.7.3 Test: employee with `puerta` role cannot access `vendedor` endpoints (RBAC check via Prisma query)

**Done when**: RBAC test green; no mysql2 in roles/authz.

### 3.8 Remaining routes audit
- [ ] 3.8.1 Run `rg 'mysql2' backend/src/ platea/` → list any remaining files
- [ ] 3.8.2 Translate each remaining site (escanear, reconciliacion, barras, eventos CRUD, revendedores CRUD, etc.) to Prisma / `$queryRaw`
- [ ] 3.8.3 FOR UPDATE sites in remaining files (Strategy A — escanear, reconciliacion, barras) use `prismaDirectUrl`
- [ ] 3.8.4 Re-run `rg 'mysql2'` → zero results

**Done when**: `rg 'mysql2' backend/ platea/` returns no output.

### 3.9 ESLint enforcement
- [ ] 3.9.1 Add `no-restricted-imports` rule to `backend/.eslintrc` blocking `mysql2` and `mysql2/promise`
- [ ] 3.9.2 Add same rule to `platea/.eslintrc`
- [ ] 3.9.3 Verify `npm run lint` exits 0 in both apps

**Done when**: lint clean; mysql2 import blocked by ESLint.

**Phase 3 acceptance**: `rg 'mysql2' backend/ platea/'` returns zero results; all routes/jobs translated; lint clean; all existing tests pass against Postgres.

---

## Phase 4 — Tests + smoke (week 5)

### 4.1 Test infrastructure rewrite
- [ ] 4.1.1 Add `docker-compose.test.yml` (or update existing) with Postgres 16 service on port 5433
- [ ] 4.1.2 Create `backend/scripts/prepare-test-db.ts`: runs `prisma migrate deploy` + seed against the test DB (replaces `prepare-test-db.cjs`)
- [ ] 4.1.3 Update npm scripts in `backend/package.json`:
  - `test:mysql:up` → `test:postgres:up` (starts Docker Postgres on port 5433)
  - `test:mysql:down` → `test:postgres:down`
- [ ] 4.1.4 Update `backend/src/test-env.ts` (or equivalent test setup file) with Postgres DSN pointing at port 5433
- [ ] 4.1.5 Verify `npm run test:postgres:up && npm test` runs successfully with at least one test

**Done when**: Docker Postgres 16 starts; one test passes.

### 4.2 Migrate existing test suite
- [ ] 4.2.1 Run full backend test suite (`npm test`) against Postgres; capture failure list
- [ ] 4.2.2 Fix each failing test: update SQL assertions, date comparisons, boolean checks
- [ ] 4.2.3 Verify transaction-based test isolation still works (rollback after each test via Prisma `$transaction` that is never committed)
- [ ] 4.2.4 Confirm all ~50 tests pass

**Done when**: `npm test` exits 0; ~50 tests green.

### 4.3 Concurrency + idempotency tests (formalize Phase 2 tests)
- [ ] 4.3.1 Add concurrency test to backend test suite: 50 workers buy last 1 ticket → exactly 1 success (formalize 2.2.7)
- [ ] 4.3.2 Add idempotency test: duplicate webhook → exactly 1 set of entradas (formalize 2.3.4)
- [ ] 4.3.3 Add partial refund race test (formalize 2.4.5)
- [ ] 4.3.4 Verify all 3 new tests are in CI test run

**Done when**: 3 concurrency/idempotency tests in suite and passing.

### 4.4 CI/CD
- [ ] 4.4.1 Add `npx prisma generate` step to install stage (before `npm ci`)
- [ ] 4.4.2 Add `npx prisma migrate deploy` step before `npm start` (uses DIRECT_URL)
- [ ] 4.4.3 Update CI env: `DATABASE_URL` (pooler), `DIRECT_URL` (direct) both set as secrets
- [ ] 4.4.4 Verify CI pipeline passes end-to-end

**Done when**: CI green with both `prisma generate` and `prisma migrate deploy` steps.

### 4.5 Documentation updates
- [ ] 4.5.1 Update `database.txt`: replace MySQL/XAMPP references with Postgres/Supabase; describe Prisma schema and migration flow
- [ ] 4.5.2 Update `queries-criticas.txt`: note which sites use `$queryRaw` (FOR UPDATE), which use Prisma client; add Prisma P2034 retry note
- [ ] 4.5.3 Update `backend.txt`: describe the two-client pattern (`prisma` vs `prismaDirectUrl`) and when each is used
- [ ] 4.5.4 Update `CLAUDE.md` project instructions:
  - Remove "add SQL to `actualizar db.sql`" rule (DEPRECATED — use `prisma migrate dev`)
  - Remove "Reference schema: `db actualizada.sql`" reference
  - Add: "Schema changes → `prisma migrate dev --name <description>` in `prisma/`"
- [ ] 4.5.5 Create `prisma/README.md` explaining: two-client pattern, when to use direct vs pooler, enum migration caveat, SERIALIZABLE retry wrapper

**Done when**: all 5 doc files updated; no MySQL references remain in docs.

### 4.6 Cleanup (remove legacy MySQL artifacts)
- [ ] 4.6.1 Delete `backend/src/lib/backend-schema.ts` (replaced entirely by `prisma/schema.prisma` + migrations)
- [ ] 4.6.2 Remove `mysql2` from `backend/package.json` dependencies
- [ ] 4.6.3 Remove `mysql2` from `platea/package.json` dependencies
- [ ] 4.6.4 Delete `actualizar db.sql` (legacy manual migration tracking file)
- [ ] 4.6.5 Delete `db actualizada.sql` (replaced by `prisma/migrations/`)
- [ ] 4.6.6 Delete `backend/scripts/prepare-test-db.cjs` (replaced by `prepare-test-db.ts` from 4.1.2)
- [ ] 4.6.7 Run `npm install` in both apps; verify no mysql2 in `node_modules/.package-lock.json`

**Done when**: git shows all legacy files deleted; `npm install` succeeds; no mysql2 in lock files.

### 4.7 End-to-end smoke test (manual)
- [ ] 4.7.1 Provision a **fresh** Supabase project; run `prisma migrate deploy` from clean state → exit 0
- [ ] 4.7.2 Run `prisma db seed` → super-admin created
- [ ] 4.7.3 Log in as super-admin; create an empresa via super-admin UI
- [ ] 4.7.4 Log in as empresa; create an evento with 2 ticket categories and 1 consumible
- [ ] 4.7.5 Buy a ticket E2E (Mercado Pago test mode) → confirm webhook arrives → `entradas` row issued
- [ ] 4.7.6 QR scan ticket via `escanear` endpoint → status changes to `usado`
- [ ] 4.7.7 Make a consumable sale via barra POS → `consumibles_ventas` row created; stock decremented
- [ ] 4.7.8 Trigger expired checkout cleanup job manually → expired sessions removed
- [ ] 4.7.9 Trigger marketing job manually → no errors
- [ ] 4.7.10 Trigger sales velocity snapshot job manually → row inserted in snapshot table

**Done when**: all 10 smoke steps pass with no errors; Supabase dashboard shows correct data.

**Phase 4 acceptance**: smoke test green E2E; `npm test` exits 0 with ~50+ tests; docs updated; all legacy MySQL artifacts deleted from repo.

---

## Rollback checklist (in case of disaster)

- [ ] R.1 `git revert` to the last commit before Phase 1 (tag it before starting as `pre-postgres-migration`)
- [ ] R.2 Restore `mysql2` dependencies: `npm install mysql2` in both apps
- [ ] R.3 Restore XAMPP MySQL env vars (`DB_HOST`, `DB_PORT=3306`, etc.) in `.env` files
- [ ] R.4 Re-deploy backend pointing at MySQL (`npm run dev` or production deploy)
- [ ] R.5 Verify checkout flow works against MySQL
- [ ] R.6 Document what went wrong in `openspec/changes/migrate-to-postgres-prisma/rollback-report.md`

---

## Quick stats

| Phase | Tasks | Key risk |
|-------|-------|----------|
| Phase 1 — Foundation | ~35 tasks | Schema completeness; missing enum or index |
| Phase 2 — Hot path | ~30 tasks | FOR UPDATE on pooler (use direct!); stock test flakiness |
| Phase 3 — Cold path | ~25 tasks | DATE_FORMAT / GROUP_CONCAT missed sites |
| Phase 4 — Tests + smoke | ~25 tasks | Test isolation with Prisma transactions |
| **Total** | **~115 tasks** | — |
