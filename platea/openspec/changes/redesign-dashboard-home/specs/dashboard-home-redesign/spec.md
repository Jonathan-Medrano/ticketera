# dashboard-home-redesign Specification

## Purpose

Definir una dirección aceptable para el home del dashboard de Platea que aproveche el contrato real del resumen: filtro por evento, eventos activos destacados y lectura operativa más clara, sin alterar permisos ni backend.

## Requirements

### Requirement: Cabecera con contexto operativo claro

The system MUST present the dashboard home with an opening section that immediately communicates context, current operational summary, and the main reading direction for the user.

#### Scenario: Usuario entra al dashboard

- GIVEN an authenticated user lands on `/dashboard`
- WHEN the first viewport renders
- THEN they can identify that they are looking at an operational home
- AND they can quickly understand what the screen summarizes

### Requirement: Filtro por evento integrado al home

The system MUST allow the user to filter the dashboard home by event using the existing `evento` query param already supported by the backend summary endpoint.

#### Scenario: Usuario selecciona un evento

- GIVEN the home has access to the list of available events
- WHEN the user selects one event in the dashboard filter
- THEN the route updates the `evento` query param
- AND the server summary is re-fetched with that same filter
- AND metrics, charts, and recent sales reflect the selected event

### Requirement: Continuidad funcional existente

The system MUST preserve the existing dashboard-home behaviors: date filters, ingresos visibility toggle, analytics tabs, and recent sales listing.

#### Scenario: Interacciones existentes siguen vivas

- GIVEN the redesign is implemented
- WHEN the user changes date filters, switches analytics tab, or toggles ingresos visibility
- THEN the same actions still work
- AND no backend contract changes are required

### Requirement: Eventos activos como señal contextual superior

The system SHOULD surface `eventos_activos` near the top of the home as an operational cue so the user can scan active agenda, sales progress, and timing without leaving the summary screen.

#### Scenario: Hay eventos activos destacados

- GIVEN `eventos_activos` contains one or more items
- WHEN the dashboard home renders
- THEN the user sees a dedicated highlighted surface for those events
- AND each item exposes at least name, date, sales progress, and state/context

### Requirement: No new carousel dependency

The system MUST implement the highlighted active-events surface without introducing a new carousel dependency.

#### Scenario: Implementación del rail de eventos

- GIVEN the project currently has no installed carousel primitive or library for the dashboard home
- WHEN the active-events surface is implemented
- THEN it uses the existing stack and local UI composition
- AND it does not require a backend or package-management change

### Requirement: Próximo evento sin duplicación innecesaria

If `proximo_evento` is available, the system SHOULD preserve it as contextual information without redundantly repeating the same message across multiple top-level blocks.

#### Scenario: Hay próximo evento y eventos activos

- GIVEN `proximo_evento` and `eventos_activos` are both available
- WHEN the dashboard home renders
- THEN the upcoming event remains visible as a clear cue
- AND the surrounding composition avoids duplicate narrative or identical highlights

### Requirement: Responsive clarity with focused event UI

The system MUST maintain readability and hierarchy within the existing dashboard layout, including narrow widths where the sidebar and top spacing affect the content area.

#### Scenario: Mobile or constrained width

- GIVEN the user views the home on a narrow viewport
- WHEN hero, event rail, filters, metrics, analytics, and recent sales collapse vertically
- THEN the reading order remains clear
- AND controls stay accessible without overlap or clipping
