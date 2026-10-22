# Design: migrate-to-postgres-prisma

| Field | Value |
|---|---|
| Status | Draft |
| Change | migrate-to-postgres-prisma |
| Project | ticketera-workspace (PlateaPro / Ticketera) |
| Phase | Design |
| Date | 2026-06-01 |
| Related | exploration.md · proposal.md · openspec/changes/migrate-to-postgres-prisma/specs/ |

---

## 1. FOR UPDATE Replacement Strategy

### Options

| Strategy | Tradeoffs | Concurrency | Pooler compat |
|---|---|---|---|
| A. `prisma.$queryRaw` + `FOR UPDATE` | Minimal redesign, no type-safety on locked rows, raw SQL stays | Excellent (row-level pessimistic lock) | OK only inside `$transaction` over direct port 5432 |
| B. `$transaction` + `SERIALIZABLE` + retry on P2034 | Fully type-safe, no raw SQL lock syntax, more conflict aborts under heavy load | Excellent (serializable retry absorbs conflicts) | OK — safe for pooler if no advisory locks |
| C. Postgres advisory locks (`pg_advisory_xact_lock`) | Highest throughput for known key spaces, no row-scan | Excellent if keys unique per resource | **Incompatible with PgBouncer transactional mode — requires direct connection** |

### Decision

**Primary: Strategy A (`$queryRaw` + `FOR UPDATE`) via direct connection (port 5432).**

Justification: The 42 lock sites are already inside explicit transaction blocks with well-understood semantics. Rewriting all 42 to `SERIALIZABLE` + retry logic (Strategy B) would require significant new error-handling scaffolding across 14 files in parallel with the syntax migration work — too much surface area to change at once. Advisory locks (Strategy C) require direct connection which we already mandate for lock sites, but impose an extra naming contract that's unnecessary when row locks already exist. Strategy A preserves the existing mental model while giving us a clean migration path.

**Exceptions by file group:**

| File | Sites | Strategy | Reason |
|---|---|---|---|
| `refund-manual.ts` | 20 | A (`$queryRaw` FOR UPDATE, direct URL) | Complex nested transactions; preserving semantics is paramount |
| `tenant.ts` | 8–9 | A (`$queryRaw` FOR UPDATE, direct URL) | Multi-table locks in single transaction; safest to preserve |
| `consumibles.ts` / `consumibles-sales.ts` / `consumibles-redeem.ts` | 5 | A (`$queryRaw` FOR UPDATE, direct URL) | Stock decrement; needs pessimistic lock |
| `vender.ts` | 1 | A (`$queryRaw` FOR UPDATE, direct URL) | Same stock model |
| `buyer-settings-service.ts` | 3 | B (`SERIALIZABLE` retry) | Low contention; upsert pattern maps cleanly to Prisma conflict handling |
| `persistent-rate-limit.ts` / `route-rate-limit.ts` (frontend) | 2 | B (`SERIALIZABLE` retry) | Rate limit counters, high frequency, no stock risk |
| All others (escanear, reconciliacion, barras, password-reset, roles, eventos) | 8 | A (`$queryRaw` FOR UPDATE, direct URL) | Safest default |

**All Strategy A sites MUST use `DIRECT_URL` (port 5432), never the pooler.**

## 2. ON UPDATE CURRENT_TIMESTAMP Replacement

### Options

| Option | Safety | Coverage | Notes |
|---|---|---|---|
| A. Prisma `@updatedAt` field attribute | Fragile — only works when mutations go through Prisma client | Partial | Breaks for all `$queryRaw` mutation sites (which are ~42 stock/lock operations) |
| B. Postgres trigger `set_updated_at()` on each table | Bulletproof — fires on any UPDATE regardless of origin | Complete | One reusable trigger function + one `CREATE TRIGGER` per table |
| C. Prisma `$use` middleware hook | Fragile — only fires for Prisma client calls; bypassed by `$queryRaw` and external tools | Partial | Same gap as A, plus deprecated in Prisma 5+ |

### Decision

**Option B — Postgres trigger on all ~20 affected tables.**

Justification: We have 42 `$queryRaw` FOR UPDATE sites that mutate rows. Options A and C both silently skip `updated_at` updates for those mutations, producing stale timestamps for checkout sessions, entradas, and consumibles — data integrity bugs that are extremely hard to notice in testing. A shared PL/pgSQL function costs 5 lines of SQL and eliminates the problem permanently across all mutation origins.

### Implementation pattern

```sql
-- One shared function (defined once in initial migration)
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- One trigger per table with updated_at (repeat for all ~20 tables)
CREATE TRIGGER trg_set_updated_at_checkout_sessions
BEFORE UPDATE ON checkout_sessions
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

Prisma schema still uses `@updatedAt` on `updated_at` fields — this makes the field informational and keeps the Prisma client in sync for Prisma-originated writes. The trigger acts as the safety net for all other origins.

## 3. Transaction Isolation Strategy

Postgres default is `READ COMMITTED` (MySQL default was `REPEATABLE READ`). The 36 existing transaction sites relied on MySQL's default without setting isolation explicitly — meaning we can now be intentional.

| Isolation Level | Where | Rationale |
|---|---|---|
| `READ COMMITTED` (Postgres default) | General queries, marketing, exports, reporting, auth token lookups | Sufficient; no phantom-read risk; lowest overhead |
| `SERIALIZABLE` | Stock decrements (`entrada_categorias.stock_disponible`, `barra_stock.stock_actual`), payment confirmation, refunds | Protects against concurrent oversell even if lock is accidentally dropped; retry on P2034 |
| `REPEATABLE READ` | Long read operations: PDF generation, full event report exports | Prevents phantom rows mid-read without full serialization overhead |

### Rules for `$transaction` calls

```typescript
// Stock / payment — SERIALIZABLE
await prisma.$transaction(async (tx) => { ... }, {
  isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  maxWait: 5000,
  timeout: 10000,
})

// General mutations — no override (READ COMMITTED default)
await prisma.$transaction(async (tx) => { ... })
```

All `SERIALIZABLE` transactions MUST catch `P2034` and retry with exponential backoff (max 3 retries, initial delay 50ms).

## 4. Case-Sensitivity Strategy

MySQL is case-insensitive by default (`utf8mb4_unicode_ci`). Postgres is case-sensitive by default. Any query comparing `slug`, `email`, or short codes without normalization will silently miss rows after migration.

| Column | Strategy | Implementation |
|---|---|---|
| `slug` (evento, empresa, tenant) | **D — Migrate stored values to lowercase + functional index** | `UPDATE eventos SET slug = LOWER(slug)`; `CREATE UNIQUE INDEX ON eventos (LOWER(slug))`; app always writes `slug.toLowerCase()` |
| `email` (usuarios, compradores, empresa) | **A + D — App-level normalization + lowercase stored value** | Trim + lowercase on write at service layer; `CREATE UNIQUE INDEX ON usuarios (LOWER(email))`; queries use `WHERE LOWER(email) = $1` |
| `code` (entradas, consumibles short codes, QR) | **A — App-level normalization** | QR codes and short codes are generated by the system; always write uppercase; compare uppercase. No schema change needed. |
| Generic text search columns (nombre, descripcion) | **C — Functional index with `LOWER()` for equality lookups** | Only if equality lookup exists; most text fields are display-only or searched via ILIKE/trgm |

**ILIKE rule**: Replace all `LIKE '%term%'` in search queries with `ILIKE '%term%'` — Postgres `ILIKE` is case-insensitive and requires no schema change. This covers event/consumible name searches.

No `CITEXT` extension — it adds implicit casting complexity and is not supported on all Supabase tiers.

## 5. FULLTEXT Search Redesign

There are 2 `MATCH ... AGAINST IN BOOLEAN MODE` sites in `consumibles.ts`, both searching `consumibles(nombre, descripcion)`.

### Decision

**Phase 1: Replace with `ILIKE` + `pg_trgm` GIN index.**

Rationale: The 2 FULLTEXT sites are for internal bar/POS staff searching consumable names — not a public search surface with complex relevance ranking requirements. A trigram similarity search via `pg_trgm` is sufficient, provides substring matching, handles typos, and integrates directly into Prisma `$queryRaw` with no external service dependency. Full `tsvector/tsquery` implementation is deferred to Phase 2 if relevance ranking becomes a product requirement.

```sql
-- One-time setup in migration
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_consumibles_nombre_trgm ON consumibles USING GIN (nombre gin_trgm_ops);
CREATE INDEX idx_consumibles_descripcion_trgm ON consumibles USING GIN (descripcion gin_trgm_ops);
```

```sql
-- Query replacement
WHERE nombre ILIKE '%' || $1 || '%' OR descripcion ILIKE '%' || $1 || '%'
-- The GIN trgm index makes ILIKE fast for this pattern
```

## 6. Connection Pooling Architecture

Supabase provides two connection endpoints:

| Env Var | URL Pattern | Use | Mode |
|---|---|---|---|
| `DATABASE_URL` | `postgres://...@pooler:6543/db?pgbouncer=true&connection_limit=1` | All Prisma client calls from runtime (backend + frontend BFF) | Transactional PgBouncer |
| `DIRECT_URL` | `postgres://...@db.project.supabase.co:5432/db` | `prisma migrate deploy`, all `$queryRaw` FOR UPDATE sites, any session-level state | Direct TCP |

**Critical constraint**: `FOR UPDATE` inside transactions MUST use a connection that holds state for the full transaction duration. PgBouncer transactional mode re-assigns connections per statement, breaking row locks. All Strategy A sites (Section 1) must acquire a direct connection.

### Prisma `schema.prisma` datasource

```prisma
datasource db {
  provider  = "postgresql"
  url       = env("DATABASE_URL")
  directUrl = env("DIRECT_URL")
}
```

When `directUrl` is set, Prisma uses `DATABASE_URL` for queries and `DIRECT_URL` for migrations automatically. For `$queryRaw` FOR UPDATE calls at runtime, we implement a second `PrismaClient` instance pointed at `DIRECT_URL`:

```typescript
// backend/src/lib/prisma.ts
export const prisma = new PrismaClient()  // uses DATABASE_URL (pooler)
export const prismaDirectUrl = new PrismaClient({
  datasources: { db: { url: process.env.DIRECT_URL } }
})  // used for all FOR UPDATE transactions
```

`prismaDirectUrl` is used **only** inside transaction blocks that contain `$queryRaw ... FOR UPDATE`. All other queries use `prisma`.

## 7. Prisma Schema Modeling Decisions

| Aspect | Decision |
|---|---|
| Identifier | Keep `INT` auto-increment → `@default(autoincrement())`. UUID is future work — changing PKs during migration adds unacceptable risk. |
| Foreign keys | Native Prisma relations where schema is explicit; `@relation` fields added incrementally. Tables with dynamic/string FKs stay as raw Int/String fields initially. |
| JSON columns | `@db.JsonB` — Postgres JSONB for indexed access. Replace `JSON_SET`/`JSON_EXTRACT` with `jsonb_set()` and `->>` operator in raw queries. |
| Enums | Native Postgres `ENUM` via Prisma `enum` block. The 13 MySQL ENUM columns map 1:1. **Important**: Postgres enums require a migration to add values — document this constraint for the team. |
| Decimal / money | `@db.Decimal(12, 2)` — same precision as MySQL. Never `Float` for money. |
| `updated_at` | Postgres trigger (Section 2) is the source of truth. Prisma field uses `@updatedAt` as informational annotation only — do NOT rely on Prisma to update it for `$queryRaw` mutations. |
| `created_at` | `@default(now())` — direct Postgres equivalent. |
| Soft delete `deleted_at` | Partial indexes `WHERE deleted_at IS NULL` for all performance-critical queries on soft-deleted tables. |
| Booleans | Prisma maps `TINYINT(1)` → `Boolean` automatically. No action needed but validate TypeScript narrowing in existing `=== 1` / `=== 0` checks — replace with `=== true`. |
| DATETIME | All timestamps stored as `TIMESTAMPTZ` (with time zone). Backend must ensure all `Date` objects are UTC before insert. |

### Schema location in monorepo

Keep `prisma/` at **repo root** (`<repo>/prisma/schema.prisma`). Both `backend/` and `platea/` reference it:

- `backend/package.json`: `"prisma": { "schema": "../prisma/schema.prisma" }`
- `platea/package.json`: `"prisma": { "schema": "../prisma/schema.prisma" }`

Generated clients go to their respective `node_modules/@prisma/client`. This avoids duplicating the schema while keeping deployments independent.

### One example model

```prisma
model CheckoutSession {
  id              Int       @id @default(autoincrement())
  evento_id       Int
  comprador_id    Int?
  status          CheckoutStatus @default(pendiente)
  total           Decimal   @db.Decimal(12, 2)
  expires_at      DateTime  @db.Timestamptz
  created_at      DateTime  @default(now()) @db.Timestamptz
  updated_at      DateTime  @updatedAt @db.Timestamptz  // trigger is source of truth
  metadata        Json?     @db.JsonB

  @@index([evento_id, status])
  @@map("checkout_sessions")
}

enum CheckoutStatus {
  pendiente
  confirmado
  expirado
  reembolsado
}
```

## 8. App Architecture

### Prisma client instances

| File | Client | URL used |
|---|---|---|
| `backend/src/lib/prisma.ts` | `prisma` (default) | `DATABASE_URL` (pooler) |
| `backend/src/lib/prisma.ts` | `prismaDirectUrl` | `DIRECT_URL` (direct — FOR UPDATE sites only) |
| `platea/lib/prisma.ts` | `prisma` (default) | `DATABASE_URL` (pooler) |

The frontend (`platea/`) NEVER uses `prismaDirectUrl` — no FOR UPDATE sites after rewriting `route-rate-limit.ts` to Strategy B.

### Graceful shutdown

```typescript
// backend/src/index.ts
process.on('SIGTERM', async () => {
  await prisma.$disconnect()
  await prismaDirectUrl.$disconnect()
  server.close(() => process.exit(0))
})
```

### Error mapping (backend middleware)

| Prisma error | HTTP status | When |
|---|---|---|
| `P2002` (unique constraint) | 409 Conflict | Duplicate slug, email, code |
| `P2003` (foreign key) | 400 Bad Request | Invalid FK reference |
| `P2025` (record not found) | 404 Not Found | `.findUniqueOrThrow()` |
| `P2034` (serialization failure) | Retry up to 3×, then 503 | Stock decrement race condition |

### Removing frontend DDL

- `platea/lib/password-version.ts`: Remove `ALTER TABLE` DDL. Move column to Prisma schema + migration. Access via `prisma.usuario.findUnique()`.
- `platea/lib/route-rate-limit.ts`: Remove `CREATE TABLE IF NOT EXISTS` + `FOR UPDATE`. Rewrite as Prisma `upsert` with `SERIALIZABLE` transaction (Strategy B — rate limit counters are low-contention).

## 9. Sequence Diagrams

### Checkout with stock lock (after migration)

```
Client                Backend                  prismaDirectUrl (direct:5432)     Supabase PG
  |                      |                               |                            |
  |-- POST /checkout --→ |                               |                            |
  |                      |-- $transaction(SERIALIZABLE) →|                            |
  |                      |    $queryRaw SELECT            |                            |
  |                      |    entrada_categoria FOR UPDATE|-- SELECT ... FOR UPDATE →  |
  |                      |                               |←-- row locked -------------|
  |                      |    check stock_disponible > 0  |                            |
  |                      |    $queryRaw UPDATE stock      |-- UPDATE stock_disponible -|
  |                      |    prisma.checkoutSession.create|-- INSERT checkout_session -|
  |                      |←-- commit -------------------|←-- ACK --------------------|
  |←-- 201 {session_id} -|                               |                            |
  |                      |                               |                            |
  |                      | [on P2034 serialization fail]  |                            |
  |                      |-- retry (max 3, backoff 50ms) →|                            |
  |                      | [after 3 failures]             |                            |
  |←-- 503 retry later --|                               |                            |
```

### Migration deploy in CI/CD

```
CI trigger
    |
    |-- prisma migrate deploy (uses DIRECT_URL:5432)
    |       |-- apply pending migrations sequentially
    |       |-- run set_updated_at() trigger function migration
    |       |-- run per-table trigger migrations (~20)
    |       |-- run pg_trgm extension + GIN indexes
    |       |-- apply slug/email lowercase data migration
    |←-- exit 0 (success) or exit 1 (fail → abort deploy)
    |
    |-- start application (backend npm start / platea next start)
    |       |-- prisma.$connect() against DATABASE_URL:6543 (pooler)
    |       |-- prismaDirectUrl.$connect() against DIRECT_URL:5432
    |←-- SIGREADY
```

## 10. Acceptance Criteria

- [ ] FOR UPDATE strategy applied and documented for all 42 lock sites (40 via Strategy A on `prismaDirectUrl`, 2 via Strategy B)
- [ ] `set_updated_at()` Postgres trigger deployed on all ~20 `updated_at` columns; integration test confirms `updated_at` increments on `$queryRaw` UPDATE
- [ ] No `mysql2` imports in `backend/` or `platea/` (enforced by ESLint `no-restricted-imports`)
- [ ] No DDL in application code — `password-version.ts` and `route-rate-limit.ts` fully migrated to Prisma
- [ ] `prisma migrate deploy` succeeds against Supabase DIRECT_URL in CI with exit code 0
- [ ] Concurrency test: 50 concurrent buyers attempting to purchase the last 1 unit of `entrada_categoria` → exactly 1 success, 49 stock-exhausted errors, `stock_disponible` = 0
- [ ] Slug/email case-sensitivity test: insert `test@example.com`, query `Test@Example.COM` → found
- [ ] All FULLTEXT `MATCH AGAINST` replaced with `ILIKE` + trgm; consumibles search returns same results as before migration
- [ ] Backend test suite green (`npm test` against Docker Postgres 16)
- [ ] E2E smoke: complete checkout flow (create session → Mercado Pago webhook → confirm → issue `entradas`) succeeds on Postgres
