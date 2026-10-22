# Sitio Venta Banner Configuration Specification

## Purpose

Define the canonical banner editing and validation contract for `Sitio de venta` so the split editor, preview, runtime, and API stay aligned for `banner_variant` and `banners`.

## Requirements

### Requirement: Split editor exposes banner configuration

The system MUST expose visible editing controls in the split `Sitio de venta` editor for `banner_variant` (`blurred` | `full`) and `banners` (`string[]`).

#### Scenario: Operator edits banner variant and banners

- GIVEN an operator opens the split `Sitio de venta` editor
- WHEN the operator navigates the visual configuration section
- THEN the editor shows a visible control for `banner_variant`
- AND the editor shows visible controls for the `banners` list

### Requirement: Canonical banner source is shared across editor, preview, and runtime

Editor, preview, and runtime MUST use the same canonical banner source for hero/banner content, and MUST NOT depend on parallel hero/banner inputs that can diverge.

#### Scenario: Preview reflects the saved banner contract

- GIVEN a `Sitio de venta` configuration with `banner_variant` and `banners`
- WHEN the operator previews and later publishes that configuration
- THEN preview and runtime resolve hero/banner content from the same canonical fields
- AND the rendered banner does not depend on an alternative source that the editor does not expose

### Requirement: API rejects invalid banner payloads

The API MUST accept only `banner_variant` values `blurred` and `full`, and MUST accept `banners` only when it has the expected array shape. The API MUST NOT silently coerce or fallback invalid payloads.

#### Scenario: Invalid banner variant is rejected

- GIVEN a client submits a `Sitio de venta` payload with `banner_variant` outside `blurred` or `full`
- WHEN the API validates the payload
- THEN the API rejects the request as invalid
- AND no fallback variant is applied

#### Scenario: Invalid banners shape is rejected

- GIVEN a client submits `banners` with a non-array or incompatible item shape
- WHEN the API validates the payload
- THEN the API rejects the request as invalid
- AND no partial normalization is applied

### Requirement: Canonical hero contract excludes legacy parallel fields

The system MUST define explicit ownership for hero/banner media before implementation is considered aligned. `banners` + `banner_variant` MUST remain the only supported hero contract, and `imagen_hero`, `imagen_footer`, and `footer_texto` MUST be unsupported/removed from editor, API, and public tenant contracts.

#### Scenario: Banner contract is documented without ambiguity

- GIVEN the `Sitio de venta` media contract is specified for editor and API consumers
- WHEN the contract is specified for editor and API consumers
- THEN each field's ownership status is explicit
- AND clients can determine that `banners` + `banner_variant` are authoritative without inference
- AND no supported contract mentions `imagen_hero`, `imagen_footer`, or `footer_texto`
