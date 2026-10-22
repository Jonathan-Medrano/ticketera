# sitio-venta-faq-management Specification

## Purpose

Definir el contrato editable de FAQs de `Sitio de venta` con defaults visibles, identidad estable y restauración no destructiva.

## Requirements

### Requirement: Defaults visibles en la colección editable

The system MUST include default FAQs inside the editable FAQ collection, not as a hidden fallback outside the editor list.

#### Scenario: Editor carga FAQs por defecto
- GIVEN a tenant has no custom FAQ overrides
- WHEN the operator opens the FAQ editor
- THEN default FAQs appear inside the editable list
- AND each one can be managed as an individual item

### Requirement: Colección mixta con identidad y orden persistibles

Default and custom FAQs MUST coexist in one collection with stable identity and persistible order.

#### Scenario: Tenant mezcla defaults y custom
- GIVEN a tenant has default FAQs and adds custom FAQs
- WHEN the collection is saved and loaded again
- THEN the same FAQ identities are preserved
- AND the saved order is preserved across all items

### Requirement: Quita individual sin borrado inferido

The system MUST allow removing one FAQ from the editable collection without inferring destructive removal of other FAQs.

#### Scenario: Operador quita una FAQ
- GIVEN the editable collection contains multiple FAQs
- WHEN the operator removes one FAQ
- THEN only that FAQ stops appearing in the collection
- AND the remaining FAQs keep their identity and order

### Requirement: Restore defaults no destructivo

The system MUST restore only missing default FAQs. The system MUST NOT overwrite custom FAQs or duplicate defaults already present.

#### Scenario: Operador restaura defaults
- GIVEN the collection keeps custom FAQs and only some defaults remain
- WHEN the operator restores default FAQs
- THEN missing defaults are added back
- AND existing custom FAQs and existing defaults remain unchanged
