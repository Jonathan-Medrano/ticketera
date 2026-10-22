# configuracion-interna Specification

## Purpose

Definir el contrato de lectura y actualización de datos internos de cuenta y empresa.

## Requirements

### Requirement: Configuración interna aislada

The system MUST expose a dedicated internal configuration contract that only reads and updates internal account fields.

#### Scenario: Guardado interno no pisa branding público
- GIVEN a user edits internal configuration
- WHEN the internal configuration payload is submitted
- THEN only internal fields are updated
- AND sitio de venta fields remain unchanged

#### Scenario: Password remains an internal concern
- GIVEN a user changes the master password
- WHEN the password endpoint is called
- THEN the password flow remains under internal configuration only
