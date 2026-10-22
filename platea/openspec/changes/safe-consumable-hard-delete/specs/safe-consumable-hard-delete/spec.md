# Safe Consumable Hard Delete Specification

## Purpose

Define how consumables are deleted safely without breaking operational or historical references.

## Requirements

### Requirement: Hard delete only when no references exist

The system MUST physically delete a consumable only when that consumable has no operational or historical references that depend on it.

#### Scenario: Consumable without references is deleted

- GIVEN a consumable exists
- AND it has no references in stock, restock alerts, promotions, sales items, or other operational/history tables
- WHEN an authorized user deletes the consumable
- THEN the consumable is physically removed from the database
- AND it no longer appears in the product catalog

### Requirement: Deletion is blocked when references exist

The system MUST reject physical deletion when the consumable is referenced by operational or historical records.

#### Scenario: Consumable referenced by stock cannot be hard deleted

- GIVEN a consumable is referenced by at least one `barra_stock` record
- WHEN an authorized user attempts to delete it
- THEN the deletion is rejected
- AND the system returns a stable error explaining that the consumable must be deactivated instead

#### Scenario: Consumable referenced by historical sales cannot be hard deleted

- GIVEN a consumable is referenced by historical sale items or related sales records
- WHEN an authorized user attempts to delete it
- THEN the deletion is rejected
- AND historical integrity remains intact

### Requirement: Deactivation remains a distinct action

The system MUST preserve deactivation as a separate operational action from deletion.

#### Scenario: User deactivates instead of deleting

- GIVEN a consumable still needs to exist historically or operationally
- WHEN an authorized user uses the activate/deactivate control
- THEN the consumable status changes without deleting the underlying record
- AND future catalog visibility reflects the new active state

### Requirement: UI communicates the distinction clearly

The consumables management UI MUST not behave as if delete and deactivate are the same action.

#### Scenario: Delete action no longer simulates deactivation

- GIVEN an authorized user deletes a consumable from the UI
- WHEN the backend confirms hard deletion
- THEN the item is removed from the current list
- AND the UI does not merely toggle `activo = 0` locally

#### Scenario: Blocked deletion shows guidance

- GIVEN a consumable cannot be deleted because references exist
- WHEN the delete action fails
- THEN the UI shows a clear error explaining why deletion is blocked
- AND the user is guided to use deactivation instead
