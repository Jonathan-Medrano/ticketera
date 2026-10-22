# database-ticketing-rebuild Specification

## Purpose

Definir la reconstrucción del schema de eventos, entradas, checkout y login token del producto.

## Requirements

### Requirement: Event and ticketing schema restored

The system MUST restore `eventos`, `evento_fechas`, `evento_tandas`, `entrada_categorias`, `entradas`, `checkout_sessions`, and `login_tokens` with the relationships required by the current code.

#### Scenario: Public tenant event flow becomes navigable
- GIVEN the ticketing schema has been rebuilt
- WHEN tenant routes query events, dates, tandas, and categories
- THEN the public event and detail flows return data without schema errors

#### Scenario: Checkout and ticket confirmation become operable
- GIVEN the ticketing schema has been rebuilt
- WHEN checkout creates reservations and later confirms them
- THEN reservation, expiration, and ticket creation queries succeed consistently

### Requirement: Ticketing layer must depend on restored core

The system MUST build the ticketing layer only after the core auth/tenant layer is valid.

#### Scenario: Ticketing rebuild waits for core completion
- GIVEN core tables are missing or incomplete
- WHEN the team attempts to validate ticketing flows
- THEN the rebuild is considered incomplete until core validation passes first
