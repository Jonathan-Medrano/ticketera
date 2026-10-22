# database-core-rebuild Specification

## Purpose

Definir la reconstrucción del schema base para autenticación, tenant y configuración general del producto.

## Requirements

### Requirement: Core auth and tenant tables restored

The system MUST restore a database core where `empresas`, `usuarios`, `compradores`, and `roles` exist with the columns required by current backend and frontend code.

#### Scenario: Empresa auth and tenant branding become queryable
- GIVEN the core schema has been rebuilt
- WHEN the application reads `empresas` for auth and tenant branding
- THEN the queries succeed without missing-column or missing-table errors

#### Scenario: Empleado auth resolves role data
- GIVEN the core schema has been rebuilt
- WHEN employee auth queries `usuarios` joined with `roles`
- THEN the login flow resolves permissions without schema errors

### Requirement: Reconstruction must be validated per layer

The system MUST rebuild the database in ordered layers and SHALL validate each layer with a functional checkpoint before continuing.

#### Scenario: Core layer is validated before ticketing
- GIVEN the core layer has been created
- WHEN validation is executed for auth and tenant endpoints
- THEN ticketing tables are not considered ready until that checkpoint passes
