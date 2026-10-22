# database-consumables-rebuild Specification

## Purpose

Definir la reconstrucción del schema de consumibles, barras, stock, promociones y ventas.

## Requirements

### Requirement: Consumables schema restored after core commerce layers

The system MUST restore `consumibles`, `barras`, `barra_stock`, `barra_restock_alertas`, `consumibles_promociones`, `consumibles_ventas`, and `consumibles_venta_items` only after core and ticketing layers are functional.

#### Scenario: Consumables CRUD becomes queryable
- GIVEN the consumables schema has been rebuilt
- WHEN the application queries or mutates consumables and bar stock data
- THEN those operations succeed without missing-table or missing-column errors

#### Scenario: Consumables sales flow becomes operable
- GIVEN the consumables schema has been rebuilt
- WHEN the application records and redeems consumable sales
- THEN sales, items, and stock operations remain consistent with current route behavior

### Requirement: Reconstruction must avoid relying on corrupted dumps as source of truth

The system MUST use current code and live validated schema as the primary source of truth, and MUST NOT rely solely on corrupted historical dumps.

#### Scenario: Corrupted dump is treated as secondary reference only
- GIVEN `db actualizada.sql` contains evidence of prior engine corruption
- WHEN reconstructing consumables tables
- THEN the final schema is derived from route/query usage first and the dump only as a secondary cross-check
