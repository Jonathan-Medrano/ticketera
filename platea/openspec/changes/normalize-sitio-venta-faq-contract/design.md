# Design: Normalize Sitio de Venta FAQ Contract

## Technical Approach

Reemplazar el array plano de FAQs por una colección normalizada y ordenable que se use igual en editor, preview y runtime. El contrato vive en `SitioVentaForm`, se serializa por el mismo PATCH actual y se resuelve desde un helper compartido en `lib/tenant-support.ts`, que también absorbe compatibilidad con arrays legacy.

## Architecture Decisions

### Decision: una sola colección persistida con provenance explícita

| Option | Tradeoff | Decision |
|---|---|---|
| Mantener fallback oculto + custom plano | Sigue el drift actual entre editor y runtime | Rechazado |
| Persistir defaults y custom en colecciones separadas | Complica reorder, restore y render | Rechazado |
| Persistir una colección mixta con `id`, `source` y `order` | Requiere normalización inicial, pero elimina ambigüedad | Elegido |

Rationale: el reorder y el restore necesitan identidad estable por item, no por índice ni por texto.

### Decision: `source` expresa origen, no modo de edición

| Option | Tradeoff | Decision |
|---|---|---|
| Editar defaults como overrides separados | Más correcto semánticamente, pero agrega otra capa contractual | Rechazado |
| Editar items `default` in place conservando `id` canónico | Restore simple, sin duplicados ni merge extra | Elegido |

Rationale: para este cambio alcanza con que `source: "default"` signifique “nació del catálogo por defecto”. Si el usuario cambia texto/respuesta, el item sigue siendo restaurable por `id`; restore sólo repone defaults ausentes y NO resetea los existentes.

## Data Flow

`tenant.faqs` / `form.faqs`
→ `parse/normalizeFaqCollection()`
→ catálogo default con ids canónicos
→ colección resultante ordenada
→ editor / preview / runtime consumen la misma salida

`restoreDefaults()`
→ compara ids actuales vs catálogo default
→ agrega sólo defaults faltantes
→ reindexa `order` sin tocar custom ni defaults existentes

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/normalize-sitio-venta-faq-contract/design.md` | Create | Diseño técnico del cambio. |
| `components/dashboard/sitio-venta/model.ts` | Modify | Nuevo shape FAQ, parse legacy y serialización persistible. |
| `components/dashboard/sitio-venta/model.test.ts` | Modify | Cobertura de normalización, compatibilidad legacy y dirty state. |
| `components/dashboard/sitio-venta/section-primitives.tsx` | Modify | Lista editable con remove, restore y reorder por `id`. |
| `components/dashboard/sitio-venta/preview/runtime-preview.tsx` | Modify | Consumir colección FAQ resuelta compartida. |
| `components/dashboard/sitio-venta/preview/runtime-preview.test.ts` | Modify | Verificar orden y alineación preview/runtime. |
| `lib/tenant-support.ts` | Modify | Catálogo default, resolver de colección resultante y restore helper. |
| `lib/tenant-support.test.ts` | Modify | Casos de defaults visibles, restore y no duplicación. |
| `lib/tenant.ts` | Modify | Parse público compatible con shape nuevo y array legado. |
| `components/tenant/soporte-content.tsx` | Modify | Runtime usa la misma colección resuelta que preview. |

## Interfaces / Contracts

```ts
type SitioVentaFaqItem = {
  id: string
  source: "default" | "custom"
  question: string
  answer: string
  order: number
}
```

Persistencia: `faqs` deja de ser `Array<{ pregunta; respuesta }>` y pasa a `SitioVentaFaqItem[]` serializable a JSON. Para mantener naming del dominio actual, implementación puede conservar `pregunta`/`respuesta` en vez de `question`/`answer`, pero el contrato DEBE sumar `id`, `source` y `order`.

Compatibilidad legacy: si `parse` recibe array plano, normaliza cada item. Si coincide exactamente con un default canónico, usa `id = default:<slug>` y `source = "default"`; si no, crea `id` determinístico (`custom:<hash>`), `source = "custom"` y `order` por posición. Tras el primer guardado, queda persistido el shape nuevo.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | Parse nuevo + legacy, ids default/custom, serialización | Extender `model.test.ts` y `tenant-support.test.ts`. |
| Unit | Restore agrega sólo faltantes y no duplica ids default | Casos puros sobre helper compartido. |
| Unit | Reorder persiste `order` y no depende de índice/texto | Helper de reorder + asserts sobre ids. |
| Integration | Preview y runtime resuelven la misma colección | Extender `runtime-preview.test.ts` y smoke de `soporte-content`. |
| Manual | Editar, quitar default, restaurar, reordenar, guardar y recargar | Validación focalizada en dashboard + soporte público. |

## Migration / Rollout

No requiere migración offline. La compatibilidad vive en lectura: el frontend/runtime aceptan array legacy y lo normalizan en memoria sin perder contenido visible. El rollout seguro depende de que preview y runtime usen el mismo resolver antes de asumir que `faqs` siempre llega en shape nuevo.

## Open Questions

- [ ] Confirmar si el backend remoto valida `faqs` item por item o si esa validación queda para el cambio de implementación.
