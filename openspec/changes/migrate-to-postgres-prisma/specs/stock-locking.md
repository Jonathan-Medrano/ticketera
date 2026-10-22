# Spec: Stock Locking

**Change:** migrate-to-postgres-prisma
**Capability:** Concurrency control for ticket and consumable stock
**RFC 2119 keywords apply throughout.**

---

## Summary

Stock locking prevents oversell. The current implementation uses `SELECT ... FOR UPDATE` row-level locks via raw MySQL queries. After migration, all lock sites MUST use a single consistent locking strategy compatible with Postgres and the chosen connection mode (pooler vs. direct). The strategy itself is decided in the design phase; this spec states what the outcome MUST guarantee.

---

## Background

Two independent stock models exist:

| Model | Table | Column | Operation |
|-------|-------|--------|-----------|
| Tickets | `entrada_categorias` | `stock_disponible` | reserve → decrement on confirm |
| Consumables | `barra_stock` | `stock_actual` | decrement on sale |

There are approximately 42 `FOR UPDATE` call sites in the backend that MUST be audited and migrated.

---

## Requirements

### R1 — No oversell under concurrency

- The locking strategy MUST guarantee that concurrent requests to purchase the last unit of a ticket category result in **exactly one** successful purchase.
- The locking strategy MUST guarantee that concurrent requests to sell the last unit of a consumable result in **exactly one** successful sale.
- A failed concurrent attempt MUST return a clean user-facing error (e.g. "stock agotado"), not a database error or 500.

### R2 — Consistent lock strategy

- ALL `FOR UPDATE` call sites MUST use **one** consistent strategy throughout the codebase. Mixed approaches (some using Prisma `$queryRaw FOR UPDATE`, others using application-level CAS, others using advisory locks) are NOT permitted unless each site type is explicitly documented and justified in the design.
- The chosen strategy MUST be compatible with the Supabase PgBouncer pooler in transaction mode (port 6543) — OR the affected queries MUST be routed to the direct connection (port 5432). The design MUST document which route each lock site uses.

### R3 — Lock sites audit

- Before the migration is considered complete, a lock site inventory MUST exist (produced during design/apply phases) that lists every former `FOR UPDATE` site and its replacement.
- No former `FOR UPDATE` site MAY be silently dropped without an explicit documented reason.

### R4 — Transaction scope

- Locks MUST be acquired and released within a single database transaction.
- Locks MUST NOT be held across HTTP request boundaries or across multiple transactions.

### R5 — Consumable and ticket locks are independent

- Locking a ticket category row MUST NOT block consumable stock operations, and vice versa.

### R6 — Cleanup job compatibility

- The `expiredCheckoutCleanupJob` that releases reserved stock MUST use the same locking strategy as the checkout creation path to avoid race conditions between job execution and concurrent buyer confirmation.

---

## Scenarios

### Scenario 1 — Concurrent ticket buyers on last unit (acceptance test)

```
Given a ticket category with stock_disponible = 1
  And 50 concurrent HTTP requests attempt to create a checkout for that category simultaneously
When all requests are processed
Then exactly 1 checkout session is created and confirmed
  And the stock_disponible is decremented to 0
  And the remaining 49 requests receive a 409 or equivalent "sold out" response
  And no database constraint violation or unhandled error occurs
```

### Scenario 2 — Concurrent consumable redemption on last unit

```
Given a consumable with barra_stock.stock_actual = 1
  And 10 concurrent redeem requests arrive simultaneously
When all requests are processed
Then exactly 1 consumable_venta record is created
  And stock_actual is decremented to 0
  And the remaining 9 requests receive a clean "no stock" error
```

### Scenario 3 — Concurrent refund and purchase

```
Given a ticket category with stock_disponible = 0
  And a refund operation is in progress that will increment stock_disponible to 1
  And a concurrent checkout creation request arrives for that category
When both operations complete
Then the final stock_disponible is 0 (one unit added, one immediately reserved)
  OR the final stock_disponible is 1 and the checkout was rejected
  And in neither case is stock_disponible negative or an inconsistent value persisted
```

### Scenario 4 — Lock does not block unrelated categories

```
Given Category A has an active checkout in progress (lock held)
  And Category B has stock available
When a buyer attempts to purchase Category B
Then the purchase for Category B succeeds without waiting for Category A's lock to release
```

### Scenario 5 — Expired checkout cleanup race

```
Given a checkout session is expired and the cleanup job begins processing it
  And simultaneously a buyer attempts to confirm that same checkout
When both operations complete
Then exactly one of the following is true:
  (a) The cleanup job restores the stock and the confirmation receives a "session expired" error
  (b) The confirmation succeeds and the cleanup job skips the session (already confirmed)
  And in no case is stock restored AND a ticket issued for the same session
```

---

## Out of Scope

- The specific Prisma API calls used for locking (design phase).
- Advisory lock implementation details (design phase).
- SKIP LOCKED usage for queue-style jobs (design phase).
