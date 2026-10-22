# sitio-venta-runtime-aligned-preview Specification

## Purpose

Definir la validación visual del editor de `Sitio de venta` como contexto integrado, liviano y subordinado al dominio activo, alineado con el runtime público real y sin convertirse en una segunda pantalla competidora.

## Requirements

### Requirement: Contexto visual integrado al flujo activo

The system MUST provide visual validation inside the flow of the active editor domain. The system MUST NOT duplicate that validation as a competing second screen or as a permanent primary reference outside the active flow.

#### Scenario: Usuario revisa un dominio activo
- GIVEN the user is editing one domain of `Sitio de venta`
- WHEN the user reviews the visual result
- THEN the visual context is integrated with the active editing flow
- AND it does not compete as a separate primary screen

#### Scenario: Usuario prioriza edición sobre validación visual
- GIVEN the user is filling or changing the active form
- WHEN the editor renders the associated preview
- THEN the preview behaves as secondary contextual support
- AND the form remains the dominant interaction surface

### Requirement: Home/Eventos evita referencias visuales principales duplicadas

The system MUST align `Home/Eventos` visual validation with `tenant-home`. `Home/Eventos` MUST NOT present both an internal preview and a contextual preview at the same time as co-equal primary references.

#### Scenario: Usuario valida Home/Eventos
- GIVEN the user edits `Home/Eventos`
- WHEN the editor shows visual validation
- THEN the runtime reference matches `tenant-home`
- AND only one primary visual reference is emphasized

#### Scenario: Usuario compara layout y copy de Home/Eventos
- GIVEN the user edits layout, visibility toggles, or editorial copy in `Home/Eventos`
- WHEN the editor shows examples or references
- THEN those references stay attached to the same active flow
- AND the editor does not introduce a second large preview surface for the same decision

### Requirement: Consumibles y Soporte mantienen alineación y alcance actual

The system MUST align `Consumibles` visual validation with the confirmed surface of `tenant-consumibles-hub` and relevant `tenant-bottom-nav` context, and MUST align `Soporte` visual validation with `soporte-content`. The system MUST keep both domains within their current confirmed scope and MUST NOT expand business behavior through preview.

#### Scenario: Usuario valida Consumibles
- GIVEN the user edits `Consumibles`
- WHEN the contextual visual reference is shown
- THEN the visible surface matches confirmed consumibles-facing runtime context
- AND no new business scope is implied

#### Scenario: Usuario valida Soporte
- GIVEN the user edits `Soporte`
- WHEN the contextual visual reference is shown
- THEN the visible structure matches `soporte-content`
- AND the scope remains limited to the current confirmed section

#### Scenario: Usuario abre un dominio de bajo alcance
- GIVEN the user navigates to `Consumibles` or `Soporte`
- WHEN the preview is rendered
- THEN the visual reference is compact and proportional to the domain scope
- AND it does not reuse the same heavy presentation style as `Home/Eventos`

### Requirement: Alcance visual excluye Mis tickets

The system MUST NOT treat `Mis tickets` as part of the editorial preview scope for this change, even if the public runtime exposes that route through shared navigation.

#### Scenario: Usuario revisa la alineación de navegación pública
- GIVEN the runtime includes shared navigation entries beyond the editor scope
- WHEN the editor previews the confirmed `Sitio de venta` domains
- THEN `Mis tickets` is not presented as an editable or previewable domain in this change
