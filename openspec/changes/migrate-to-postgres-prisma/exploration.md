# Exploration: migrate-to-postgres-prisma

**Date:** 2026-06-01  
**Phase:** explore  
**Change:** Migrate PlateaPro / Ticketera from MySQL/MariaDB (XAMPP) to PostgreSQL on Supabase with Prisma ORM

---

## 1. Schema Inventory

### Source of truth
All runtime schema mutations live in `backend/src/lib/backend-schema.ts` (1710 lines).  
The frontend also runs schema mutations from `platea/lib/password-version.ts`.

### Table count
**39 tables** defined in `backend-schema.ts` via `CREATE TABLE IF NOT EXISTS` plus ~15–20 additional tables
that are referenced but defined earlier in the codebase (in the main `db actualizada.sql` / live schema):

Tables in `backend-schema.ts` (39):
- `landing_announcement`
- `evento_reviews`
- `referidos_programa`, `referidos`
- `consumibles_venta_resolucion_items`
- `buyer_phone_verification_challenges`
- `delivery_dispatch_attempts`
- `empresa_payment_accounts`
- `platform_payment_accounts`
- `platform_admin_user_flow_shares`
- `platform_sale_allocations`
- `platform_admin_relationships`
- `platform_admin_closure`
- `platform_admin_capability_grants`
- `platform_admin_revenue_grants`
- `platform_admin_migration_audit`
- `refund_manual_cases`
- `refund_manual_case_items`
- `refund_manual_case_events`
- `refund_manual_case_consumible_items`
- `refund_manual_case_consumible_item_events`
- `empleados_actividad`
- `marketing_oauth_accounts`
- `barra_stock_logs`
- `marketing_segmentos`, `marketing_segmentos_compradores`
- `marketing_campanas`, `marketing_envios`
- `marketing_codigos_descuento`, `marketing_codigos_descuento_usos`
- `storage_cleanup_runs`
- `platform_admin_users`
- `platform_marketplace_fee_defaults`
- `empresa_marketplace_fee_overrides`
- `evento_ventas_snapshot`
- `platform_impersonation_tokens`
- `platform_messages`, `platform_message_dismissals`
- `soporte_mensajes`
- `rate_limit_buckets` (created in `platea/lib/route-rate-limit.ts`)

Tables referenced but defined outside `backend-schema.ts` (from `database.txt`):
- `empresas`, `usuarios`, `roles`, `compradores`
- `password_reset_tokens`, `login_tokens`
- `eventos`, `evento_tandas`, `evento_fechas`, `entrada_categorias`, `entradas`
- `checkout_sessions`
- `empresa_marketplace_fees` (legacy, still referenced)
- `consumibles`, `barras`, `barra_stock`, `barra_restock_alertas`
- `consumibles_promociones`, `consumibles_ventas`, `consumibles_venta_items`, `consumibles_canje_auditoria`
- `audit_logs`, `processed_webhooks`

**Total estimated tables: ~58–62**

### Column types requiring translation

| MySQL Type | Count (approx) | Postgres equivalent |
|---|---|---|
| `TINYINT(1)` | ~15 occurrences (booleans) | `BOOLEAN` |
| `ENUM(...)` | 13 column definitions in `backend-schema.ts` alone | `text` with CHECK constraint, or Postgres native `enum` type |
| `DATETIME` | ~60+ columns | `TIMESTAMP WITHOUT TIME ZONE` or `TIMESTAMPTZ` — requires decision |
| `TIMESTAMP` | ~10 columns (`created_at`, `updated_at` in some tables) | `TIMESTAMPTZ` |
| `AUTO_INCREMENT` | ~12 tables use integer PKs | `GENERATED ALWAYS AS IDENTITY` (or `SERIAL`) |
| `BIGINT` | `reset_at_ms` in rate_limit_buckets | `BIGINT` (compatible) |
| `LONGTEXT` | `home_sections`, `info_pages` columns | `TEXT` (Postgres TEXT is unbounded) |
| `JSON` | `metadata JSON` in `empleados_actividad`, `payload_json text` in others | `JSONB` preferred |
| `FULLTEXT INDEX` | 1 index on `consumibles(nombre, descripcion)` | Postgres `tsvector` / `GIN` index — significant rewrite |
| `INT AUTO_INCREMENT` | ~12 tables | `SERIAL` or `GENERATED ALWAYS AS IDENTITY` |
| `VARCHAR(36)` UUIDs | All primary PKs on 39+ tables | `UUID` native type (or keep `TEXT`) |

### MySQL-specific DDL constructs

| Construct | Occurrences (non-test) | Notes |
|---|---|---|
| `ENGINE=InnoDB` | 39+ | Remove — no Postgres equivalent |
| `CHARSET=utf8mb4 COLLATE=...` | 39+ | Remove — Postgres uses DB-level encoding |
| `KEY idx_name (cols)` | ~80+ | Becomes `CREATE INDEX` outside CREATE TABLE |
| `UNIQUE KEY uq_name (cols)` | ~40+ | Becomes `UNIQUE INDEX` |
| `ON UPDATE CURRENT_TIMESTAMP` | ~20+ | Not supported natively — needs triggers or app-level update |
| `ALTER TABLE ... MODIFY COLUMN` | 3 | Postgres uses `ALTER COLUMN TYPE` |
| `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` | 50+ | Postgres supports `IF NOT EXISTS` in pg 9.6+ |
| `ALTER TABLE ... ADD INDEX IF NOT EXISTS` | ~10 | Postgres: `CREATE INDEX IF NOT EXISTS` |

### Indexes and Constraints
- No explicit foreign key definitions found in `backend-schema.ts` (intentional — FK enforcement is at app level)
- No TRIGGERS or STORED PROCEDURES found
- 1 FULLTEXT index (`ft_consumibles_busqueda` on `consumibles`) — critical rewrite path
- No composite CHECK constraints beyond ENUMs
- No sequences beyond AUTO_INCREMENT

---

## 2. MySQL-Specific Syntax Inventory

### Critical — requires rewrite

| Syntax | Files (prod, non-test) | Occurrences | Postgres equivalent |
|---|---|---|---|
| `ON DUPLICATE KEY UPDATE` | 15 files | ~22 occurrences | `ON CONFLICT ... DO UPDATE` (Prisma `upsert`) |
| `INSERT IGNORE` | ~8 files | ~12 occurrences | `ON CONFLICT DO NOTHING` |
| `FOR UPDATE` | 14 files | ~42 occurrences | `SELECT ... FOR UPDATE` exists in Postgres — but Prisma does not expose it |
| `DATE_FORMAT(x, '%Y-%m-%d')` | `ventas.ts`, `entradas.ts` | ~4 occurrences | `TO_CHAR(x, 'YYYY-MM-DD')` |
| `DATE_SUB(NOW(), INTERVAL n UNIT)` | ~10 files | ~30+ occurrences | `NOW() - INTERVAL 'n unit'` |
| `DATE_ADD(x, INTERVAL n UNIT)` | ~8 files | ~15 occurrences | `x + INTERVAL 'n unit'` |
| `GROUP_CONCAT(... ORDER BY ...)` | `tenant.ts`, `compradores.ts` | ~4 occurrences | `STRING_AGG(... ORDER BY ...)` |
| `SUBSTRING_INDEX(...)` | `tenant.ts` | 2 occurrences | `SPLIT_PART` or subquery |
| `MATCH(x) AGAINST (? IN BOOLEAN MODE)` | `consumibles.ts` | 2 occurrences | `to_tsvector + to_tsquery` or `pg_trgm` — non-trivial rewrite |
| `FULLTEXT INDEX` | `backend-schema.ts` | 1 definition | Postgres `GIN` index on `tsvector` column |
| `JSON_SET(...)` | `backend-schema.ts` | 2 occurrences | `jsonb_set(...)` |
| `JSON_EXTRACT(...)` | `backend-schema.ts` | 2 occurrences | `data->>'key'` or `data->'key'` |
| `ON UPDATE CURRENT_TIMESTAMP` | ~20+ columns | All `updated_at` columns | Requires Postgres trigger per table |
| `INFORMATION_SCHEMA.STATISTICS` | `backend-schema.ts` | ~10 occurrences | `pg_indexes` view |
| `information_schema.tables WHERE table_schema = DATABASE()` | `backend-schema.ts` | ~8 occurrences | `pg_tables WHERE schemaname = 'public'` |
| `information_schema.columns WHERE table_schema = DATABASE()` | `backend-schema.ts` | 1 occurrence | `information_schema.columns` works in Postgres too, different predicates |
| `SHOW FULL TABLES` | `prepare-test-db.cjs` | 3 occurrences | `\dt` / `pg_tables` query |
| `SHOW CREATE TABLE` | `prepare-test-db.cjs` | 1 occurrence | No Postgres equivalent — requires pg_dump |
| `SET FOREIGN_KEY_CHECKS = 0` | `prepare-test-db.cjs` | 1 occurrence | `SET session_replication_role = 'replica'` in Postgres |
| Backtick identifiers `` `name` `` | `backend-schema.ts` line 1418 | 1 occurrence | Double-quote identifiers `"name"` |

### Lower-risk (but need verification)

| Syntax | Notes |
|---|---|
| `COALESCE(...)` | Fully compatible with Postgres |
| `NOW()` | Compatible |
| `CURRENT_TIMESTAMP` | Compatible |
| `CASE WHEN ... END` | Compatible |
| `TRIM(...)` | Compatible |
| `LOWER(...)` | Compatible |
| `CONCAT(...)` | Compatible |

---

## 3. FOR UPDATE / Lock Call Sites — CRITICAL

Prisma does NOT expose `SELECT ... FOR UPDATE` natively. Every call site below needs a design decision (raw SQL via `prisma.$queryRaw`, or a Prisma-aware locking strategy).

**42 `FOR UPDATE` occurrences across 14 production files:**

### `backend/src/routes/tenant.ts` — 8 occurrences
- Line 577: `SELECT ... FROM checkout_sessions WHERE id = ? FOR UPDATE` — checkout confirmation lock
- Line 593: `SELECT ... FROM entrada_categorias WHERE id IN (...) FOR UPDATE` — ticket stock lock
- Line 613: `SELECT ... FROM entrada_categorias WHERE id = ? FOR UPDATE` — ticket reserve lock
- Line 882: `SELECT ... FROM entrada_categorias WHERE id IN (...) FOR UPDATE` — consumable checkout lock
- Line 2261: `SELECT ... FROM marketing_codigos_descuento WHERE id = ? FOR UPDATE` — discount code lock
- Line 2292: `SELECT ... FROM barra_stock WHERE ... FOR UPDATE` — consumable stock lock
- Line 2543: `SELECT ... FROM checkout_sessions WHERE id = ? FOR UPDATE` — reorder/re-confirm lock
- Line 2587: `SELECT ... FROM entrada_categorias ... FOR UPDATE` — ticket quantity lock
- Line 2696: `SELECT ... FROM marketing_codigos_descuento WHERE id = ? FOR UPDATE` — discount enforcement

### `backend/src/lib/refund-manual.ts` — 20 occurrences
- Lines 501, 577, 592, 605, 857, 894, 936, 953, 988, 1101, 1156, 1182, 1204, 1249, 2122, 2162, 2534 and more
- Targets: `checkout_sessions`, `entrada_categorias`, `entradas`, `barra_stock`, `consumibles_ventas`, `refund_manual_cases`
- All inside `beginTransaction` blocks

### `backend/src/services/checkoutCleanup.ts` — 1 occurrence
- Line 129: `SELECT ... FROM checkout_sessions WHERE estado = 'pendiente' AND expires_at < ? FOR UPDATE`
- Runs every 30 seconds as background job — stock restoration after expiry

### `backend/src/routes/vender.ts` — 1 occurrence
- Line 91: `SELECT ... FROM barra_stock WHERE barra_id = ? AND consumible_id IN (...) FOR UPDATE`
- Batch lock for consumable sales

### `backend/src/routes/reconciliacion.ts` — 2 occurrences
- Line 587: checkout_sessions lock
- Line 713: `SELECT ... FROM entrada_categorias WHERE id = ? FOR UPDATE`

### `backend/src/routes/eventos.ts` — 1 occurrence
- Line 2051: `SELECT id FROM entrada_categorias WHERE id = ? AND evento_id = ? FOR UPDATE`

### `backend/src/routes/barras.ts` — 1 occurrence
- Line 576: `SELECT ... FROM barra_stock WHERE barra_id = ? AND consumible_id IN (...) FOR UPDATE`

### `backend/src/routes/roles.ts` — 1 occurrence
- Line 49: `SELECT id FROM roles WHERE empresa_id = ? FOR UPDATE` — role initialization lock

### `backend/src/lib/buyer-settings-service.ts` — 3 occurrences
- Lines 104, 205, 336: phone verification challenges and buyer profile locks

### `backend/src/lib/consumibles-redeem.ts` — 4 occurrences
- Lines 187, 203, 216, 546: consumable redemption locks

### `backend/src/lib/consumibles-sales.ts` — 1 occurrence
- Line 28: `SELECT estado, barra_id FROM consumibles_ventas WHERE id = ? FOR UPDATE`

### `backend/src/lib/password-reset.ts` — 1 occurrence
- Line 350: password reset token lock

### `backend/src/lib/persistent-rate-limit.ts` — 1 occurrence
- Line 57: rate limit bucket lock (backend)

### `platea/lib/route-rate-limit.ts` — 1 occurrence
- Line 64: rate limit bucket lock (frontend/Next.js side)

**All 42 `FOR UPDATE` calls are inside explicit `beginTransaction` blocks.**  
**Zero `LOCK IN SHARE MODE` occurrences found.**

---

## 4. Transaction Patterns

### Pattern
All transactions use `pool.getConnection()` → `connection.beginTransaction()` → `try/catch` → `connection.commit()` / `connection.rollback()` → `finally connection.release()`.

### Files with transaction blocks (production code only):
- `backend/src/routes/tenant.ts` — 3 transaction sites (checkout confirm, discount code usage, consumable checkout)
- `backend/src/routes/vender.ts` — 1 (consumable POS sale)
- `backend/src/routes/barras.ts` — 1 (barra stock adjustment)
- `backend/src/routes/eventos.ts` — 4 (categoria edit, evento delete, capacity changes)
- `backend/src/routes/roles.ts` — 1 (role initialization)
- `backend/src/routes/reconciliacion.ts` — 1 (refund + stock restoration)
- `backend/src/routes/ventas.ts` — 1 (export transaction)
- `backend/src/services/checkoutCleanup.ts` — 1 (cleanup job — loops per expired session)
- `backend/src/services/deliveryRetry.ts` — 1 (uses connection but pattern differs)
- `backend/src/lib/buyer-settings-service.ts` — 5 transactions
- `backend/src/lib/consumibles-redeem.ts` — 2 transactions
- `backend/src/lib/password-reset.ts` — 2 transactions
- `backend/src/lib/persistent-rate-limit.ts` — 1 transaction
- `backend/src/lib/platform-governance.ts` — 3 transactions
- `backend/src/lib/platform-profit-sharing.ts` — 1 transaction
- `backend/src/lib/refund-manual.ts` — 8+ transactions (most complex file)
- `backend/src/lib/superadmin-demo-seed.ts` — 2 transactions (seed only)
- `platea/lib/route-rate-limit.ts` — 1 transaction (frontend rate-limit)

**Total: ~38 explicit transaction sites in production code.**

### Savepoints: NONE found.
### Explicit isolation level setting: NONE found (uses MySQL default — REPEATABLE READ).
### Nested transactions: NONE found.

### Connection management note
The `deliveryRetry.ts` uses `pool.getConnection()` without a wrapping `beginTransaction` for some operations — needs verification.

---

## 5. Frontend DB Usage (platea/)

The Next.js frontend has its own `mysql2/promise` pool (`platea/lib/db.ts`). This is **separate** from the backend pool and connects to the same DB.

### Files in `platea/` that directly use the DB pool:

| File | What it does | MySQL-specific features used |
|---|---|---|
| `platea/lib/db.ts` | Pool creation | `mysql.createPool(...)` — needs full replacement with Prisma Client |
| `platea/lib/buyer-auth.ts` | Buyer authentication | `COALESCE`, JOIN — compatible |
| `platea/lib/buyer-token-auth.ts` | Magic token consumption | UPDATE + SELECT — uses `ResultSetHeader`, `affectedRows` |
| `platea/lib/auth-identities.ts` | Company/platform admin login | LOWER/TRIM — compatible |
| `platea/lib/password-version.ts` | Password change tracking + schema migration | `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `TINYINT(1)`, `datetime` |
| `platea/lib/route-rate-limit.ts` | Rate limiting | `FOR UPDATE`, `ON DUPLICATE KEY UPDATE`, `CREATE TABLE IF NOT EXISTS`, `ENGINE=InnoDB`, `utf8mb4` |

**Critical finding:** `platea/lib/password-version.ts` runs `ALTER TABLE` DDL mutations at runtime from the Next.js process. This is a schema migration running from the frontend — will need to be removed entirely and replaced by Prisma migrations.

**Critical finding:** `platea/lib/route-rate-limit.ts` runs `CREATE TABLE IF NOT EXISTS` DDL, `FOR UPDATE`, and `ON DUPLICATE KEY UPDATE` from the Next.js process. Full rewrite needed.

---

## 6. Test Infrastructure

### Docker setup
- `backend/docker-compose.test.yml` — MySQL 8.4 on port 3307
- Container name: `platea-backend-mysql-test`
- No bootstrap SQL file present — schema is bootstrapped by calling `ensureBackendSchema()` at test start

### Test setup script
- `backend/scripts/prepare-test-db.cjs` — uses `SHOW FULL TABLES`, `SHOW CREATE TABLE`, `SET FOREIGN_KEY_CHECKS = 0` (all MySQL-specific)
- Copies source schema tables to test DB by reading `SHOW CREATE TABLE` and re-executing — **100% MySQL-specific, full rewrite needed**

### Test count
- 59 `*.test.ts` files in `backend/src/`
- Tests use `pool.getConnection()` → `connection.beginTransaction()` → test body → `connection.rollback()` (transactional isolation pattern)
- Tests hit a real MySQL DB — no mocks for DB layer

### Impact of switching to Postgres
- `prepare-test-db.cjs` must be fully rewritten using `pg`/`psql` or Prisma migrate
- Docker Compose file needs a `postgres:16` image instead of `mysql:8.4`
- All test setup code that references MySQL-specific introspection must be replaced
- The "clone source schema to test DB" pattern can be replaced by `prisma migrate deploy` on the test DB

### Frontend tests
- `platea/` has test files for auth, rate limiting, buyer settings — these indirectly exercise DB via the frontend pool
- `platea/buyer-token-auth.test.ts`, `platea/auth-identities.test.ts` — mock the `query` function, not the pool directly

---

## 7. Subtle MySQL Behaviors That Break Silently in Postgres

### HIGH severity

| Behavior | MySQL | Postgres | Impact |
|---|---|---|---|
| `ON UPDATE CURRENT_TIMESTAMP` | Native column attribute | Not supported | ALL ~20 `updated_at` columns silently stop auto-updating. Silent data corruption. |
| Default string comparison | Case-insensitive with `utf8mb4_general_ci` | Case-sensitive | `WHERE slug = 'MySlug'` fails if stored as `myslug`. Auth and tenant lookups affected. |
| Isolation level | `REPEATABLE READ` (default) | `READ COMMITTED` (default) | All 38 transaction sites may see different concurrency behavior. Phantom reads possible. |
| `TINYINT(1)` as boolean | Automatically treated as boolean by `mysql2` | `SMALLINT` or `BOOLEAN` — driver returns int, not bool | ~15 columns returned as `0/1` instead of `true/false`. TypeScript narrowing breaks. |
| `ENUM` stored as string ordinal position internally | Values stored efficiently | `CHECK` constraint or enum type — no silent widening | Adding values to ENUM in Postgres requires `ALTER TYPE` which locks table; in MySQL was `ALTER TABLE MODIFY COLUMN` |

### MEDIUM severity

| Behavior | MySQL | Postgres | Impact |
|---|---|---|---|
| `''` vs `NULL` | MySQL silently coerces empty strings in some contexts | Strict NULL semantics | Queries using `COALESCE(x, '')` behave differently |
| `INSERT ... SELECT` with auto-increment | Returns last insert ID | Returns affected rows / `RETURNING` needed | `ResultSetHeader.insertId` usage must be audited |
| `DATETIME` vs `TIMESTAMPTZ` | `DATETIME` stores local time, no TZ info | `TIMESTAMP WITHOUT TIME ZONE` or `TIMESTAMPTZ` | All date comparisons with `NOW()` may be off if server TZ differs from UTC. All event `fecha` columns at risk. |
| FULLTEXT boolean mode | `IN BOOLEAN MODE` with `*` wildcards | `tsvector` / `pg_trgm` — different syntax and semantics | Consumable search (`MATCH AGAINST IN BOOLEAN MODE`) must be rewritten |
| `GROUP_CONCAT` max length | Default 1024 bytes — silently truncates | No limit in `STRING_AGG` | `tenant.ts` lines 1822–1823 use this for case lookups — truncation risk |
| `SUBSTRING_INDEX` | MySQL-only function | No direct equivalent — use `SPLIT_PART` or regex | 2 occurrences in `tenant.ts` |

### LOW severity

| Behavior | Notes |
|---|---|
| `DATE_FORMAT` / `DATE_SUB` / `DATE_ADD` | Straightforward syntax change; ~50 total occurrences |
| `SHOW TABLES`, `SHOW CREATE TABLE` | Only in test infra scripts — scoped rewrite |
| `INFORMATION_SCHEMA.STATISTICS` | Used in `hasIndex()` helper — must use `pg_indexes` view |
| `DATABASE()` function | Used to scope `INFORMATION_SCHEMA` queries — becomes `current_database()` or schema name |

---

## 8. Files That Do NOT Need Migration

| File/Category | Reason |
|---|---|
| `.env.example` files | Config only, no SQL |
| `backend/src/middleware/auth.ts` | No DB syntax, only header validation |
| `backend/src/middleware/authz.ts` | Reads from request user object |
| `platea/lib/backend-proxy.ts` | HTTP proxy, no DB |
| `platea/lib/tenant-host.ts` | URL parsing, no DB |
| Documentation `.txt`, `.md` files | Not code |
| `backend/backend-agent.md`, `db-agent.md` | Agent docs |
| Frontend UI components (no DB access) | Most of `platea/components/**` |
| Webhook signature verification | No DB SQL |
| `backend/src/lib/encryption.ts` (if exists) | Crypto only |

---

## Summary Numbers

| Category | Count |
|---|---|
| Total tables estimated | ~58–62 |
| Tables with explicit DDL in `backend-schema.ts` | 39 |
| `FOR UPDATE` call sites (production) | 42 |
| Transaction blocks (production, excl. seeds) | ~36 |
| `ON DUPLICATE KEY UPDATE` (production) | ~22 |
| `INSERT IGNORE` (production) | ~12 |
| `DATE_SUB` / `DATE_ADD` occurrences | ~50 |
| `DATE_FORMAT` occurrences | ~4 |
| `GROUP_CONCAT` occurrences | ~4 |
| `SUBSTRING_INDEX` occurrences | 2 |
| FULLTEXT search queries | 2 |
| ENUM column definitions (schema file) | 13 |
| `TINYINT(1)` boolean columns | ~15 |
| `AUTO_INCREMENT` integer PK tables | ~12 |
| `ON UPDATE CURRENT_TIMESTAMP` columns | ~20 |
| Frontend (platea) files with direct DB access | 6 |
| Frontend DDL-running files | 2 (`password-version.ts`, `route-rate-limit.ts`) |
| Backend test files | 59 |
| Test infrastructure files needing full rewrite | 1 (`prepare-test-db.cjs`) |

---

## Key Architectural Observations

1. **The schema has no migrations — it has runtime DDL.** `ensureBackendSchema()` runs on every server boot. This entire function must be replaced by Prisma schema + `prisma migrate deploy`. The 50+ `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` calls in `backend-schema.ts` become Prisma migration history.

2. **The frontend runs DDL.** `platea/lib/password-version.ts` and `platea/lib/route-rate-limit.ts` run `CREATE TABLE` and `ALTER TABLE` from the Next.js process. These must be moved entirely to Prisma migrations and the frontend must use a Prisma client (or proxy through the backend API for rate-limiting).

3. **FOR UPDATE is the most critical design decision.** 42 call sites, all in transactions, protecting stock locks, payment sessions, and refund flows. Prisma has no native `.forUpdate()`. Options: `prisma.$queryRaw`, or wrap critical sections with advisory locks (`pg_advisory_xact_lock`), or use Prisma's `$transaction` with raw SQL for lock-dependent queries.

4. **The entire `hasTable()` / `hasIndex()` helper pattern is MySQL-specific.** These use `INFORMATION_SCHEMA.STATISTICS` with `DATABASE()`. The equivalent Postgres queries use `pg_indexes` and `pg_tables`. With Prisma, these helpers become obsolete (Prisma owns the schema).

5. **`ON UPDATE CURRENT_TIMESTAMP` is pervasive and silent.** ~20 `updated_at` columns rely on MySQL auto-update. In Postgres, every `updated_at` column needs either an application-level update in every Prisma mutation or a database trigger. Prisma can handle this via middleware (global beforeUpdate hook) or triggers.

6. **FULLTEXT search on `consumibles` needs a real Postgres search solution.** The `MATCH(...) AGAINST(? IN BOOLEAN MODE)` pattern maps to either `pg_trgm` (fuzzy, good for short names) or `tsvector` (full text, better for descriptions). This is a non-trivial decision.

7. **Two separate DB connection pools.** Backend has its own `mysql2` pool in `backend/src/db.ts`; frontend has its own pool in `platea/lib/db.ts`. Both must be replaced with a single Prisma Client instance shared appropriately (or two Prisma Client instances pointing to the same Supabase Postgres).
