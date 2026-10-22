# Spec: Transactions and Isolation

**Change:** migrate-to-postgres-prisma
**Capability:** Transactional integrity for multi-statement business operations
**RFC 2119 keywords apply throughout.**

---

## Summary

PlateaPro has approximately 36 transaction sites that currently rely on MySQL's `REPEATABLE READ` default isolation. Postgres defaults to `READ COMMITTED`. After migration, all multi-statement operations MUST remain atomic. Isolation MUST be explicitly chosen per site rather than assumed from the database default. Serialization failures (deadlocks, serialization conflicts) MUST be handled gracefully.

---

## Requirements

### R1 — All multi-statement operations remain transactional

- Every operation that touches more than one row or more than one table MUST execute inside a single database transaction.
- Partial success (some statements committed, others not) MUST NOT be observable from outside the transaction.
- The following operations are known transaction boundaries and MUST remain wrapped:
  - Checkout creation (reserve stock + create `checkout_sessions` row)
  - Payment webhook processing (confirm payment + issue `entradas` or `consumibles_ventas` + decrement stock)
  - Refund processing (cancel `entradas` + restore stock + record refund)
  - Expired checkout cleanup (delete `checkout_sessions` + restore stock)
  - Consumable sale (create `consumibles_ventas` + decrement `barra_stock`)
  - Bulk ticket generation (for resellers)

### R2 — Default isolation level documented

- The Postgres default isolation level (`READ COMMITTED`) MUST be documented in the codebase (in a config or comment) so future developers understand the baseline.
- The application MUST NOT assume MySQL `REPEATABLE READ` semantics anywhere.

### R3 — Isolation upgrades are targeted and explicit

- Transactions MUST be run at `Serializable` isolation ONLY where required (i.e. where phantom reads or write skew would produce incorrect results).
- Each site that uses elevated isolation MUST include a code comment explaining why `READ COMMITTED` is insufficient.
- The design phase MUST produce an isolation audit table that lists all 36 transaction sites, their current MySQL isolation assumption, and their required Postgres isolation level.

### R4 — Retry-on-conflict wrapper

- Any transaction running at `Serializable` isolation MUST be wrapped in a retry loop that handles `SerializationFailure` errors (Postgres error code `40001`) and `Deadlock` errors (code `40P01`).
- The retry loop MUST implement exponential backoff with jitter.
- The retry loop MUST have a maximum retry count (SHOULD be 3–5 attempts).
- After exhausting retries, the operation MUST return a clean user-facing error, not a raw database error.
- The retry wrapper MUST be a shared utility, not duplicated per call site.

### R5 — Idempotency for webhook processing

- The payment webhook handler MUST be idempotent: processing the same `payment_id` twice MUST produce the same result as processing it once (no duplicate `entradas`, no double stock decrement).
- Idempotency MUST be enforced inside a transaction with an appropriate isolation level (at minimum `READ COMMITTED` with a unique constraint check; `Serializable` if a check-then-insert pattern is used).

### R6 — No cross-request transaction state

- A database transaction MUST NOT span more than one HTTP request.
- The Prisma client instance used for a transaction MUST be the same instance for all statements in that transaction (no mixing of client instances within one logical transaction).

---

## Scenarios

### Scenario 1 — Payment webhook idempotency

```
Given a payment webhook for payment_id = "MP-12345" has already been processed
  And the corresponding entradas rows exist
When the same webhook is received again (MP retry or duplicate delivery)
Then the handler detects the duplicate within a transaction
  And returns HTTP 200 without creating duplicate entradas
  And stock_disponible is NOT decremented again
  And no serialization or unique-constraint error propagates to the webhook caller
```

### Scenario 2 — Refund atomicity

```
Given a confirmed ticket purchase with 3 entradas
When a refund is initiated for that purchase
Then inside a single transaction:
  All 3 entradas rows are marked as cancelled
  AND stock_disponible is incremented by 3
  AND a refund record is created
When the transaction commits
Then all three changes are visible together
  And a partial state (some entradas cancelled but stock not restored) is never observable
When the transaction fails mid-way
Then the entire transaction rolls back
  And the entradas and stock remain unchanged
```

### Scenario 3 — Stock decrement atomicity (consumable sale)

```
Given barra_stock.stock_actual = 5
When a consumable sale is processed
Then inside a single transaction:
  stock_actual is decremented by the quantity sold
  AND a consumibles_ventas record is created
When the transaction commits
Then stock_actual = 4 (or less if quantity > 1) and the sale record exists
When the transaction rolls back (e.g. network error after decrement)
Then stock_actual is restored and no orphan sale record exists
```

### Scenario 4 — Serialization failure retry

```
Given two concurrent Serializable transactions T1 and T2 operating on overlapping rows
When Postgres detects a serialization conflict and aborts T2 with error 40001
Then the retry wrapper catches error 40001
  And retries T2 up to the configured maximum
  And on success returns the correct result
  And on exhausted retries returns HTTP 409 or 503 with a user-friendly message
  And no raw "ERROR: could not serialize access due to concurrent update" reaches the API response
```

### Scenario 5 — Expired checkout cleanup does not partially restore stock

```
Given 10 expired checkout sessions exist
When the cleanup job runs
Then each session is processed in its own transaction:
  The checkout_sessions row is deleted
  AND stock_disponible is incremented for the reserved quantity
For each session, the transaction either commits fully or rolls back fully
  And no session leaves behind a deleted checkout with unrestored stock
  And no session leaves behind a restored stock with an undeletted checkout row
```

---

## Out of Scope

- The specific Prisma API (`$transaction`, `interactiveTransactions`) used for each site (design phase).
- The complete isolation audit table per transaction site (design phase).
- Distributed transaction patterns (not required; single DB).
