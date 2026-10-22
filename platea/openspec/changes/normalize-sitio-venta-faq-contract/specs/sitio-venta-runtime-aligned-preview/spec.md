# sitio-venta-runtime-aligned-preview Specification

## Purpose

Alinear preview y runtime de soporte para que ambos consuman la misma colección FAQ resultante y respeten el mismo orden visible.

## Requirements

### Requirement: Preview y runtime comparten la colección FAQ resultante

Preview editor and runtime support MUST consume the same resulting FAQ collection. The system MUST NOT apply divergent fallback rules or destructive merges between those surfaces.

#### Scenario: Operador valida preview y runtime
- GIVEN a tenant has a saved FAQ collection with default and custom items
- WHEN the operator checks preview and the public runtime
- THEN both surfaces resolve the same FAQ set
- AND neither surface adds or hides items through exclusive fallback behavior

### Requirement: El orden persistido gobierna preview y runtime

The persisted FAQ order MUST be changeable and MUST govern both preview and runtime rendering.

#### Scenario: Operador reordena FAQs
- GIVEN a tenant changes the order of the FAQ collection
- WHEN preview and runtime render the saved FAQs
- THEN both surfaces render the FAQs in that saved order
- AND the order does not fall back to source type, text, or insertion inference
