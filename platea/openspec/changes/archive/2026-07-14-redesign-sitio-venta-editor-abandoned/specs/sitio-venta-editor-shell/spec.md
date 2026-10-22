# sitio-venta-editor-shell Specification

## Purpose

Definir la shell del editor de `Sitio de venta` para una fase de simplificación radical, con una sola tarea principal por vez, menor carga visual y continuidad del contrato vigente de guardado.

## Requirements

### Requirement: Navegación editorial por dominios con foco principal único

The system MUST organize the editor into the domains `Identidad y Colores`, `Home/Eventos`, `Consumibles`, and `Soporte`, using lighter-weight navigation that keeps one primary editorial task visible at a time.

#### Scenario: Usuario abre la shell editorial
- GIVEN the user opens the `Sitio de venta` editor
- WHEN the main shell is rendered
- THEN the four confirmed domains are visible as navigation choices
- AND only the active domain owns the primary editorial surface

#### Scenario: Usuario cambia de dominio
- GIVEN the user is working inside one active domain
- WHEN the user selects another domain from the shell navigation
- THEN the shell swaps the primary editorial task to the selected domain
- AND the previous domain stops competing as a co-equal surface

### Requirement: Jerarquía visual simplificada de la shell

The system MUST present one strong editorial surface for the active domain. The shell SHOULD reduce redundant strong surfaces, nested cards, and repeated explanatory blocks when they do not add editorial clarity or ownership meaning.

#### Scenario: Usuario navega un dominio activo
- GIVEN the user is editing one active domain
- WHEN the shell presents the editing flow
- THEN the main work happens inside one dominant editorial surface
- AND redundant strong containers are reduced

#### Scenario: Usuario necesita entender qué hacer primero
- GIVEN the user opens a domain with multiple editable controls
- WHEN the shell renders the active canvas
- THEN the controls are grouped by editing priority
- AND the interface communicates a clear first action without scanning multiple competing blocks

### Requirement: Dominios menores con peso visual proporcional

The system MUST keep `Consumibles` and `Soporte` visually lighter than `Identidad y Colores` and `Home/Eventos` when their confirmed scope is narrower.

#### Scenario: Usuario abre Consumibles o Soporte
- GIVEN the user navigates to `Consumibles` or `Soporte`
- WHEN the domain content is displayed
- THEN the UI presents a compact editorial flow proportional to that domain's confirmed scope
- AND it does not mimic the density of the more complex domains

### Requirement: Alcance conservado y contrato estable

The system MUST preserve section ownership and the current functional save contract for `Sitio de venta`. The system MUST keep `Consumibles` and `Soporte` within their current confirmed scope, and MUST NOT add `Mis tickets` or expand business behavior in this change.

#### Scenario: Usuario revisa dominios de alcance acotado
- GIVEN the user navigates `Consumibles` or `Soporte`
- WHEN the section content is displayed
- THEN only the current confirmed editorial scope is exposed
- AND no new business controls or domains are introduced

#### Scenario: Guardado desde la shell simplificada
- GIVEN the user edits one or more confirmed domains
- WHEN the user saves the editor
- THEN the same `Sitio de venta` contract remains the source of persisted data
- AND the simplified shell does not require a different save behavior
