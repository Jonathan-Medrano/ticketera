# sitio-venta-settings Specification

## Purpose

Definir el contrato de lectura y actualización de branding, slug y contenido público del sitio.

## Requirements

### Requirement: Sitio de venta aislado

The system MUST expose a dedicated sitio de venta contract that only reads and updates public/editorial fields.

#### Scenario: Guardado del sitio no pisa datos internos
- GIVEN a user edits branding or editorial fields
- WHEN the sitio de venta payload is submitted
- THEN only sitio de venta fields are updated
- AND internal account fields remain unchanged

#### Scenario: Slug validation belongs to sitio de venta
- GIVEN a user edits the public slug
- WHEN the sitio de venta payload is submitted
- THEN slug validation and uniqueness checks are handled by the sitio de venta contract
