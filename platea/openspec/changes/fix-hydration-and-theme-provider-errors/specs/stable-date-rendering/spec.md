# Stable Date Rendering Specification

## Purpose

Define how server-rendered dashboard dates avoid client/server text mismatches during hydration.

## Requirements

### Requirement: Stable date output for dashboard entries

The system MUST render date/time text in a deterministic way for the affected dashboard surfaces so that the server-rendered HTML matches the client-rendered HTML during hydration.

#### Scenario: Entries table date stays stable across hydration

- GIVEN a dashboard entries row has a `created_at` timestamp
- WHEN the page is server-rendered and then hydrated on the client
- THEN the visible date/time text remains identical
- AND the entries table does not trigger a hydration mismatch for that cell

### Requirement: Deterministic formatting strategy

The system MUST avoid locale-sensitive rendering paths that produce different text between Node.js and the browser for the same value in the affected dashboard render path.

#### Scenario: Date formatting does not depend on browser-specific locale serialization

- GIVEN a timestamp rendered in the dashboard entries view
- WHEN the same value is formatted on server and client
- THEN the chosen format is deterministic enough to avoid text drift caused by locale differences
