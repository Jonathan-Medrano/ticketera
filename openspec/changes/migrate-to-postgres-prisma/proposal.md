# Proposal: Migrate to PostgreSQL + Prisma

## Status
- Proposed: 2026-06-01
- Owner: (autor)
- Change ID: migrate-to-postgres-prisma

## Intent

Replace the existing MySQL/XAMPP + raw `mysql2` data layer in both the `backend/` (Express) and `platea/` (Next.js) apps with Supabase PostgreSQL and Prisma ORM. The result is a production-ready managed database with formal versioned migrations, full TypeScript type safety across all query call sites, and alignment with Supabase Storage (already in production). The platform moves from a development-only XAMPP setup to a deploy-ready infrastructure without preserving any existing data.

## Motivation

**Why now?** The platform is pre-production with only test/demo data — there is no safer window to perform a full database layer swap. Shipping to production on XAMPP is not viable; a managed DB is required.

**Why Supabase?** Supabase Storage is already running there. Consolidating the database on the same platform reduces operational surface, aligns billing, and gives direct access to Supabase's connection pooler (PgBouncer port 6543) and direct connection (port 5432) out of the box.

**Why Prisma?** The team chose Prisma over Kysely after an honest tradeoff comparison. Prisma's auto-migrations (`prisma migrate deploy`) replace the current `ensureBackendSchema()` runtime DDL pattern — a 1710-line function that runs on every boot and has no version history. Prisma also provides a generated, type-safe client that eliminates the class of runtime SQL errors the current raw-query approach carries.

## Scope

### In scope
- `backend/` full DB layer migration — all raw `mysql2` queries translated to Prisma Client
- `platea/` DB layer migration — `lib/db.ts` rewritten; DDL removed from `password-version.ts` and `route-rate-limit.ts`
- `backend/src/lib/backend-schema.ts` deleted — replaced by `schema.prisma` + `prisma migrate deploy`
- All ~1336 query call sites translated (Prisma Client where possible; `$queryRaw` fallback for `FOR UPDATE` lock sites and complex MySQL-dialect rewrites)
- MySQL-dialect SQL rewritten: `ON DUPLICATE KEY UPDATE` → `ON CONFLICT DO UPDATE`, `INSERT IGNORE` → `ON CONFLICT DO NOTHING`, `DATE_SUB/ADD` → interval syntax, `DATE_FORMAT` → `TO_CHAR`, `GROUP_CONCAT` → `STRING_AGG`, `SUBSTRING_INDEX` → `SPLIT_PART`, `MATCH AGAINST` → `tsvector`/`pg_trgm`, `JSON_SET/JSON_EXTRACT` → `jsonb_set`/`->>` (42 `FOR UPDATE` sites, ~22 `ON DUPLICATE KEY`, ~12 `INSERT IGNORE`, ~50 date functions, ~4 `GROUP_CONCAT`)
- `ON UPDATE CURRENT_TIMESTAMP` columns (~20) — explicit handling via Prisma middleware or Postgres trigger
- FULLTEXT search on `consumibles` — replaced with `pg_trgm` GIN index or `tsvector`
- `hasIndex` helper (10 call sites using `INFORMATION_SCHEMA.STATISTICS`) — replaced with `pg_indexes` or removed
- Test infrastructure rewrite: Docker MySQL 8.4 → Docker Postgres 16; `prepare-test-db.cjs` full rewrite; all 59 backend test files validated
- Connection pooling strategy: pooler port 6543 for short runtime queries; direct port 5432 for migrations and any `FOR UPDATE` long-transaction routes
- `prisma db seed` integration for super-admin bootstrap
- CI/CD: `prisma migrate deploy` step added before app start
- `.env` variables: `DB_*` vars replaced with `DATABASE_URL` (pooler) + `DIRECT_URL` (direct)
- Docs update: `database.txt`, `queries-criticas.txt`, `CLAUDE.md`, `backend.txt`

### Out of scope
- Supabase Storage migration (already on Supabase — no changes)
- Mercado Pago integration changes
- Auth model changes
- New business features
- Data migration from existing XAMPP DB (test/demo data only — discardable, rebuilt via seed)

## Approach

### Strategy: Big-bang

A big-bang cutover is correct here. There is no production data to preserve — all existing data is test/demo and will be discarded. Dual-write (running MySQL and Postgres simultaneously) would double the migration complexity and risk for zero benefit. We migrate the entire data layer in one branch, run the full test suite against Postgres, and merge when green.

### Phased delivery (work phases, not migration phases)

The database is replaced once. Work is sequenced to maintain a runnable app throughout development.

| Phase | Focus | Duration |
|-------|-------|----------|
| 1 — Foundation | `schema.prisma` authored from `backend-schema.ts` + `db actualizada.sql`; Prisma client setup in both apps; Supabase project provisioned; `.env` wired; first migration deployed | 1 week |
| 2 — Hot path | Auth, checkout, stock, Mercado Pago webhooks, tenant routing, `FOR UPDATE` lock sites, all transaction sites | 1–2 weeks |
| 3 — Cold path | Exports, background jobs, marketing, reportes, super-admin queries, remaining routes | 1 week |
| 4 — Tests + smoke | Test infra rewrite, full suite green on Postgres, concurrency test, E2E smoke test | 1 week |

**Total target**: 4–6 weeks.

### Critical design decisions deferred to design phase

The following require dedicated design before implementation:

1. **`FOR UPDATE` replacement** (42 sites) — options: `$queryRaw('SELECT ... FOR UPDATE')` inside `$transaction`, serializable isolation + retry loop, or Postgres advisory locks. The choice affects all of Phase 2.
2. **`ON UPDATE CURRENT_TIMESTAMP`** (~20 columns) — Prisma `$use` middleware (app-level) vs. Postgres `BEFORE UPDATE` trigger (DB-level). Silent breakage risk is CRITICAL.
3. **FULLTEXT search** — `pg_trgm` + GIN index vs. `tsvector` + `to_tsquery` vs. external search (Meilisearch). Affects consumibles search UX.
4. **Isolation level** — MySQL default is REPEATABLE READ; Postgres default is READ COMMITTED. 36 transaction sites may behave differently; design must audit which ones depend on repeatable-read semantics.
5. **Supabase pooler + `FOR UPDATE`** — PgBouncer in transactional mode does NOT support session-level locks. Routes using `FOR UPDATE` must connect via direct port 5432, not pooler. Design must identify which routes need which connection.

## Affected Modules

| Module | Change | Call sites |
|--------|--------|------------|
| `backend/src/lib/backend-schema.ts` | DELETED — replaced by `schema.prisma` | — |
| `backend/src/db.ts` | REWRITTEN — exports Prisma Client instead of mysql2 pool | — |
| `backend/src/routes/*` (29 files) | All query call sites translated | ~1200 |
| `backend/src/lib/*` (~15 files) | Domain libs translated; `refund-manual.ts` most complex (20 FOR UPDATE) | ~100 |
| `backend/src/jobs/*` (~5 files) | Cron jobs translated; `checkoutCleanup.ts` has 1 FOR UPDATE | ~30 |
| `platea/lib/db.ts` | REWRITTEN — Prisma Client | — |
| `platea/lib/password-version.ts` | DDL removed; table moved to schema.prisma | 1 |
| `platea/lib/route-rate-limit.ts` | DDL + FOR UPDATE removed; rewritten with Prisma | 1 |
| `backend/scripts/prepare-test-db.cjs` | REWRITTEN for Postgres (SHOW FULL TABLES etc. removed) | — |
| `docker-compose.test.yml` | NEW — Postgres 16 replaces MySQL 8.4 | — |
| `package.json` (both apps) | `-mysql2`, `+@prisma/client`, `+prisma` | 2 |
| `.env` / `.env.example` (both apps) | `DB_*` → `DATABASE_URL` + `DIRECT_URL` | 2 |
| CI/CD config | Add `prisma migrate deploy` before app start | TBD |

## Risks and Mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| `FOR UPDATE` redesign breaks stock locking under concurrency | CRITICAL | Design phase decides approach; concurrency test (50 concurrent buyers, same `entrada_categoria`) MUST pass before merge |
| `ON UPDATE CURRENT_TIMESTAMP` silent breakage | CRITICAL | Prisma middleware or Postgres trigger; automated test that mutates each affected table and asserts `updated_at` changed |
| Supabase pooler incompatible with `FOR UPDATE` (session-level locks) | CRITICAL | Direct connection (port 5432) for all lock sites; pooler (port 6543) for all other queries — must be explicit per route |
| Case-sensitive string comparisons break slugs and auth lookups | HIGH | Audit all `WHERE slug = ?`, `WHERE email = ?`, `WHERE tenant = ?`; normalize at write time or use `CITEXT` extension |
| Frontend DDL in `platea/` breaks under Prisma | HIGH | Remove DDL from `password-version.ts` and `route-rate-limit.ts` in Phase 1; tables go into `schema.prisma` |
| Isolation level change (REPEATABLE READ → READ COMMITTED) causes lost-update bugs | HIGH | Design phase audits 36 transaction sites; flag those that need `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` explicitly |
| FULLTEXT search loses fidelity | MEDIUM | Use `pg_trgm` + GIN index; test with representative consumibles queries before shipping |
| Test infrastructure delay blocks validation | MEDIUM | Start `docker-compose.test.yml` + `prepare-test-db.cjs` rewrite in parallel with Phase 1 schema work |
| `DATETIME` without timezone — event dates and checkout timestamps off | MEDIUM | Set `timezone = 'UTC'` on Supabase project; validate checkout expiry logic explicitly |

## Rollback Plan

- **Git revert** to the last commit on `master` before migration branch merges
- **Recreate XAMPP local DB** from `db actualizada.sql` dump (all data is test/demo — no production loss)
- **Re-deploy backend** with `mysql2` dependencies restored
- No production data at risk; rollback window is approximately 30 minutes per environment
- Keep a tagged commit (`pre-postgres-migration`) as the explicit revert anchor

## Success Criteria

- [ ] `prisma migrate deploy` succeeds on a fresh Supabase project with zero manual steps
- [ ] All query call sites compile and pass `tsc --noEmit` in both apps
- [ ] Full backend test suite runs against Postgres and is green (all 59 test files)
- [ ] Concurrency test: 50 concurrent buyers on the same `entrada_categoria` do NOT oversell (stock locking holds)
- [ ] E2E smoke test passes: registration → buy ticket → MP webhook → ticket issued → consumable sale → QR redeem
- [ ] All `mysql2` imports removed from both apps (`rg 'mysql2'` returns zero results)
- [ ] `backend-schema.ts` deleted from the repository
- [ ] `ON UPDATE CURRENT_TIMESTAMP` verified: each affected table's `updated_at` updates correctly after a row mutation
- [ ] Case-sensitivity verified: tenant slug and email lookups return correct results with mixed-case input

## Open Questions for Design Phase

1. `$queryRaw` vs. `$transaction` with `SERIALIZABLE` isolation vs. Postgres advisory locks — which approach for `FOR UPDATE` sites? The choice has concurrency, performance, and complexity tradeoffs.
2. How is `FULLTEXT` search replaced on `consumibles(nombre, descripcion)` — `pg_trgm`, `tsvector`, or an external engine?
3. Are there latent race conditions in the current checkout flow that this migration should opportunistically harden?
4. Minimum Prisma version for full Postgres 15/16 compatibility (especially `jsonb`, `pg_trgm`, advisory locks)?
5. Is `prisma db seed` sufficient for the super-admin bootstrap flow, or does `seed:superadmin-demo` need a separate wrapper?
6. Which of the 36 transaction sites depend on REPEATABLE READ semantics and need an explicit isolation level set in Postgres?
