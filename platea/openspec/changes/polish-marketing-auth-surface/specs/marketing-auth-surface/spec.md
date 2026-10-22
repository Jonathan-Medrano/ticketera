# marketing-auth-surface Specification

## Purpose

Define a verifiable UX/UI quality baseline for the marketing login/register surface so it becomes clearer, more consistent, accessible, and responsive without changing its existing auth flow or base structure.

## Requirements

### Requirement: Preserved auth shell structure

The system MUST preserve the existing auth shell across login and register views, including the tabs, centered auth card, current stepper placement, and the base page layout. Visual refinement MAY improve spacing and styling, but it MUST NOT relocate or remove those structural elements.

#### Scenario: Existing structure remains recognizable

- GIVEN a reviewer compares the updated surface with the current login/register shell
- WHEN tabs, card placement, stepper placement, and page layout are inspected
- THEN the same structural composition is still present
- AND the auth flow order and available actions are unchanged

### Requirement: Clear tab hierarchy and states

The system MUST make login/register tabs clearly distinguishable in active, inactive, hover, focus, and disabled states. The selected tab MUST expose both visual emphasis and programmatic state, and inactive tabs MUST remain discoverable without competing equally with the active one.

#### Scenario: Active tab is unmistakable

- GIVEN the auth surface renders with one tab selected
- WHEN the tab list is inspected visually and semantically
- THEN the active tab is identifiable through at least two cues
- AND the selected state is exposed to assistive technology

#### Scenario: Keyboard user navigates tabs

- GIVEN a keyboard-only user moves focus across the tabs
- WHEN focus reaches an interactive tab
- THEN the focused tab shows a visible focus indicator
- AND focus visibility does not depend on color change alone

### Requirement: Clear form feedback and submission states

The system MUST provide consistent feedback for default, hover, focus, invalid, disabled, and loading states across inputs and actions. Validation and server errors MUST appear in text near the affected field or form context, MUST NOT rely only on color, and loading submission MUST prevent accidental duplicate submits.

#### Scenario: Field validation error is actionable

- GIVEN a user submits a form with an invalid field
- WHEN validation runs
- THEN the affected field shows an error message in text
- AND the error is visually associated with that field

#### Scenario: Loading state prevents duplicate submit

- GIVEN a valid form is submitted
- WHEN the request enters a loading state
- THEN the primary submit action becomes non-repeatable
- AND the loading state remains visually clear until completion

### Requirement: Accessible password input refinement

The system MUST improve the password input without changing the existing password flow, field order, or submit behavior. The password visibility toggle MUST be keyboard operable, MUST have an accessible name that reflects its action, and MUST NOT clear the value or move focus unexpectedly.

#### Scenario: User toggles password visibility

- GIVEN a user has typed a password
- WHEN they activate the visibility toggle by keyboard or pointer
- THEN the password visibility changes without losing the typed value
- AND focus remains stable and predictable

### Requirement: Consistent dark mode behavior

The system MUST present the auth surface consistently in dark mode, including tabs, card, stepper, inputs, buttons, helper text, and errors. Text contrast MUST remain readable, interactive states MUST remain perceivable, and no surface may appear as an unthemed light artifact inside dark mode.

#### Scenario: Dark mode keeps state clarity

- GIVEN the auth surface is rendered in dark mode
- WHEN the reviewer inspects default, hover, focus, error, disabled, and loading states
- THEN each state remains visually distinguishable
- AND no key auth surface breaks dark mode consistency

### Requirement: Responsive usability without structural relocation

The system MUST remain usable on narrow and wide viewports without moving the main structure away from its current composition. The centered card MUST remain the primary interaction area, controls MUST stay reachable, and the layout MUST avoid horizontal scrolling, clipped actions, or obscured stepper/tab content.

#### Scenario: Narrow viewport remains operable

- GIVEN the auth surface is viewed on a narrow mobile viewport
- WHEN tabs, stepper, fields, and primary actions are reviewed
- THEN the full flow remains readable and operable
- AND no essential control is clipped, overlapped, or pushed off-screen

#### Scenario: Desktop layout preserves hierarchy

- GIVEN the auth surface is viewed on a desktop viewport
- WHEN the full page hierarchy is inspected
- THEN the centered card remains the focal interaction area
- AND responsive refinements do not flatten or relocate the main structure
