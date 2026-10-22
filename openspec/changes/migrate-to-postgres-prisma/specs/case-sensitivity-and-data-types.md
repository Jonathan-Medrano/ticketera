# Spec: Case Sensitivity and Data Types

**Change:** migrate-to-postgres-prisma
**Capability:** String comparison behavior and column type correctness
**RFC 2119 keywords apply throughout.**

---

## Summary

MySQL is case-insensitive by default for string comparisons; Postgres is case-sensitive. MySQL uses `TINYINT(1)` for booleans and `DATETIME` (naive) for timestamps; Postgres has native `BOOLEAN` and `TIMESTAMPTZ`. MySQL's `ON UPDATE CURRENT_TIMESTAMP` has no Postgres equivalent. All four differences MUST be addressed explicitly so that lookups, boolean checks, and timestamp handling work correctly after migration.

---

## Requirements

### R1 — Case-insensitive lookups normalized explicitly

- All lookups on slug, email, tenant_slug, code, QR code, or any other identifier that was previously case-insensitive in MySQL MUST normalize case explicitly in the application or use the `CITEXT` Postgres extension.
- The chosen strategy (application-level `toLowerCase()` / `toUpperCase()` before query, OR `CITEXT` column type) MUST be applied consistently across all affected columns.
- Mixed strategies (some columns CITEXT, others using `LOWER()` in SQL) are acceptable ONLY if the design documents which approach applies to which column group and why.
- After migration, a lookup using the wrong case MUST behave identically to the correct case (i.e. the case-insensitivity guarantee is preserved).

### R2 — Affected columns identified

- The design phase MUST produce an inventory of all columns that are used in case-insensitive comparisons in the current codebase.
- Known affected columns include (but are not limited to):
  - `tenants.slug`
  - `users.email` (and equivalent in `empresas`, `empleados`, `compradores`, `super_admins`)
  - `entrada_categorias.codigo` (QR/access code lookups)
  - `eventos.slug`
  - Any column used in a `WHERE ... = ?` or `LIKE ?` that carries user-submitted free-text identifiers

### R3 — `updated_at` auto-update

- All `updated_at` columns (approximately 20 identified in the proposal) MUST auto-update to the current timestamp whenever the row changes.
- The mechanism (Prisma `@updatedAt` decorator, Postgres trigger, or Prisma middleware) MUST be chosen in the design phase and applied consistently to ALL `updated_at` columns.
- Mixing mechanisms across tables is NOT permitted.
- After migration, an UPDATE to any row that has an `updated_at` column MUST result in `updated_at` being set to the current timestamp without the application explicitly providing the value.

### R4 — Timezone-aware timestamps

- All `DATETIME` and `TIMESTAMP` columns MUST be migrated to `TIMESTAMPTZ` (timestamp with time zone) in Postgres.
- All timestamp values MUST be stored and retrieved in UTC.
- The application MUST NOT assume a local timezone when reading or writing datetime values.
- Prisma MUST be configured to handle `TIMESTAMPTZ` columns as JavaScript `Date` objects (this is the Prisma default for Postgres).

### R5 — Boolean columns

- All columns currently using `TINYINT(1)` as a boolean in MySQL MUST be migrated to Postgres `BOOLEAN`.
- The application MUST NOT compare boolean columns to integer values (e.g. `WHERE active = 1`).
- Prisma maps `BOOLEAN` to TypeScript `boolean` — the application MUST use `true`/`false` literals for boolean comparisons.

### R6 — No silent data type coercion

- The application MUST NOT rely on MySQL's implicit type coercion (e.g. comparing a string `"1"` to a boolean column, or a string to an integer).
- Any such implicit coercion found during the migration MUST be made explicit in application code.

---

## Scenarios

### Scenario 1 — Mixed-case slug lookup

```
Given a tenant with slug = "MiEvento" stored in the database
When a request arrives with slug = "mievento" (all lowercase)
Then the lookup finds the tenant successfully
  And returns the correct tenant data
  And no "tenant not found" error is returned
When a request arrives with slug = "MIEVENTO" (all uppercase)
Then the same tenant is found
```

### Scenario 2 — Email login case normalization

```
Given a user registered with email = "User@Example.COM"
When a login attempt is made with email = "user@example.com"
Then the user is found in the database
  And authentication proceeds normally
  And no "user not found" error occurs due to case mismatch
```

### Scenario 3 — `updated_at` auto-update on row change

```
Given a row in `eventos` with updated_at = T1
When the row's `nombre` column is updated via a Prisma update call (without explicitly setting updated_at)
Then after the update, updated_at > T1
  And updated_at reflects the time of the update (within a 1-second tolerance)
  And the application code does NOT need to pass updated_at to the update call
```

### Scenario 4 — Datetime read/write across timezones

```
Given a server running in UTC
  And a client in timezone UTC-3 submitting a datetime value
When the datetime is stored in a TIMESTAMPTZ column
Then it is stored as UTC internally
When the value is read back by a client in UTC+5
Then the raw UTC value is returned (no implicit timezone shift by the DB)
  And the application layer is responsible for any display timezone conversion
```

### Scenario 5 — Boolean column comparison

```
Given an `empleados` row with activo = true (stored as Postgres BOOLEAN)
When a query filters WHERE activo = true (using Prisma boolean literal)
Then the row is returned correctly
When a WHERE activo = 1 comparison is attempted
Then the TypeScript compiler (via Prisma types) raises a type error at compile time
  (OR the query fails at runtime with a clear type mismatch error, not silent wrong results)
```

### Scenario 6 — QR code case-insensitive lookup

```
Given a QR code value "ABC-123" stored in the entradas table
When the QR scanner submits "abc-123" (lowercase) to the check-in endpoint
Then the ticket is found and validated successfully
  And the check-in does NOT fail with "ticket not found"
```

---

## Out of Scope

- Full-text search behavior changes (MySQL FULLTEXT vs Postgres `tsvector` — separate concern, out of scope for this spec).
- Collation configuration details for CITEXT extension (design phase).
- Application-level timezone display logic (outside database layer).
