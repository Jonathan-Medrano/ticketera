# sitio-venta-settings Specification

## Purpose

Definir el contrato persistible de FAQs de `Sitio de venta` para edición, guardado y compatibilidad razonable con datos existentes.

## Requirements

### Requirement: Contrato FAQ persistible

The system MUST persist FAQs as one collection whose items carry enough identity and ordering information to be edited, reordered, removed, and restored without ambiguity.

#### Scenario: Guardado conserva semántica FAQ
- GIVEN the operator saves a FAQ collection with default and custom items
- WHEN the saved settings are read later
- THEN the collection still identifies each FAQ item consistently
- AND the order remains available for later editing and rendering

### Requirement: Compatibilidad con array plano legado

The system MUST maintain reasonable compatibility for tenants that currently persist FAQs as a flat array.

#### Scenario: Tenant legado abre configuración
- GIVEN a tenant still stores FAQs as a flat array
- WHEN the settings are loaded through the new contract
- THEN the FAQs are exposed as a valid editable collection
- AND the tenant does not lose visible FAQ content during that transition
