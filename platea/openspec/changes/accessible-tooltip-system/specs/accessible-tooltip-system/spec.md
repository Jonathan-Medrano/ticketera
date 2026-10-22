# accessible-tooltip-system Specification

## Purpose

Definir tooltips accesibles y consistentes para acciones compactas del frontend, reemplazando el uso disperso de `title` en controles icon-only del dashboard y tenant navbar.

## Requirements

### Requirement: Primitive base de tooltip accesible

The system MUST provide a base tooltip primitive for non-touch hover/focus disclosure. It MUST open on pointer hover and keyboard focus, close on blur, pointer leave, Escape, or trigger activation, and render in a floating layer visually aligned with existing overlays using `bg-popover`, foreground text, rounded corners, and subtle ring/shadow treatment.

#### Scenario: Usuario de teclado revela texto de ayuda

- GIVEN an enabled trigger with tooltip content
- WHEN the trigger receives focus by keyboard
- THEN the tooltip becomes visible without moving focus
- AND Escape closes it while focus stays on the trigger

#### Scenario: Dispositivo con coarse pointer

- GIVEN a mobile or coarse-pointer environment
- WHEN the same trigger is tapped
- THEN the tooltip MUST NOT appear as hover-only UI
- AND the action proceeds normally

### Requirement: Abstracción para acciones icon-only

The system MUST provide an abstraction for icon-only actionable controls with a required `label`. That `label` MUST be applied as the accessible name through `aria-label` and MUST be the default tooltip content for eligible devices. Screen readers MUST get the action name without needing the tooltip to be open. The abstraction MUST NOT rely on the HTML `title` attribute as the primary accessibility mechanism.

#### Scenario: Botón icon-only con label

- GIVEN an icon-only action rendered through the abstraction
- WHEN assistive technology inspects the control
- THEN the control exposes the `label` as its accessible name
- AND desktop users receive the same text through the tooltip

#### Scenario: Acción con texto visible

- GIVEN a button or link already showing a clear visible text label
- WHEN the control is rendered
- THEN a tooltip SHOULD NOT be added by default

### Requirement: Reglas de aplicación y disabled

The system MUST use tooltips for collapsed sidebar navigation, compact topbar actions, pagination/icon-only table actions, and similar controls where meaning is otherwise hidden or purely iconic. It MUST NOT add tooltips to long-form explanatory text, controls whose visible label already communicates the action, or content that only duplicates adjacent text. Disabled native buttons MUST NOT be the tooltip trigger directly; when explanatory text is needed, the tooltip trigger MUST be a non-disabled wrapper and the disabled control MUST keep its disabled behavior.

#### Scenario: Item de sidebar colapsado

- GIVEN the dashboard sidebar is collapsed on desktop
- WHEN a user hovers or focuses a nav item
- THEN the tooltip shows that item's label
- AND the item keeps its existing `aria-label`

#### Scenario: Acción disabled con explicación

- GIVEN an unavailable action needs explanation
- WHEN the control is disabled
- THEN the tooltip can still be reached through a wrapper on desktop/focus
- AND the disabled button itself remains non-interactive

### Requirement: Cobertura del rollout inicial

The system MUST be applied in the first rollout to dashboard tables/listados that currently use icon-only actions or pagination buttons, the dashboard sidebar collapsed state, and the tenant topbar icon-only actions. Rollout acceptance MUST verify consistency across those surfaces before broader adoption.

#### Scenario: Verificación del rollout inicial

- GIVEN the first rollout is complete
- WHEN the listed surfaces are reviewed on desktop and mobile
- THEN eligible icon-only controls show consistent tooltip behavior on desktop
- AND mobile/coarse-pointer views preserve labels through accessible names without hover UI
