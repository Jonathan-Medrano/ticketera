# Consumable Status Management Specification

## Purpose

Define the operational meaning of active/inactive status independently from physical deletion.

## Requirements

### Requirement: Active status controls visibility, not existence

The system MUST treat the `activo` state of a consumable as a visibility/operational toggle, not as a synonym for deletion.

#### Scenario: Inactive consumable still exists

- GIVEN a consumable is deactivated
- WHEN the catalog is queried with inactive items included
- THEN the consumable still exists in persistence
- AND it can be identified as inactive rather than deleted

#### Scenario: Active toggle can restore an inactive consumable

- GIVEN a consumable exists but is inactive
- WHEN an authorized user activates it again
- THEN the same consumable record becomes active
- AND no new consumable record is created
