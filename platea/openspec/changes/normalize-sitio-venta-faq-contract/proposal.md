# Proposal: Normalize Sitio de Venta FAQ Contract

## Intent

Corregir un problema de contrato, no sólo de UI: hoy las FAQs custom válidas reemplazan visualmente a las FAQs por defecto porque editor, preview y runtime dependen de un array plano con fallback excluyente. El cambio debe llevar las FAQs del `Sitio de venta` a un modelo editable con identidad, origen y orden estables.

## Scope

### In Scope
- Editor FAQ del `Sitio de venta`.
- Contrato editable/default/custom de FAQs.
- Preview/runtime de soporte alineados con ese contrato.
- Restore defaults no destructivo.
- Reordenamiento de preguntas.

### Out of Scope
- Cambiar negocio de soporte más allá de FAQs.
- Rediseñar todo `tenant-support`.
- Inventar otro sistema de ayuda distinto.

## Capabilities

### New Capabilities
- `sitio-venta-faq-management`: FAQs editables con identidad estable, convivencia entre defaults y custom, restore no destructivo y orden persistible.

### Modified Capabilities
- `sitio-venta-settings`: reemplazar el array plano de FAQs por un contrato persistible con metadata de origen/orden.
- `sitio-venta-runtime-aligned-preview`: consumir el mismo contrato FAQ en preview y runtime, sin merge destructivo ni fallback excluyente.

## Approach

Modelar cada FAQ como entidad con `id` estable, `source` (`default`/`custom`) y `order`. Los defaults pasan a ser parte del estado editable en vez de un fallback oculto. El usuario puede quitarlos, reordenarlos y restaurarlos agregando sólo los defaults faltantes, sin pisar custom existentes.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `components/dashboard/sitio-venta/model.ts` | Modified | Nuevo shape FAQ y serialización persistible. |
| `components/dashboard/sitio-venta/section-primitives.tsx` | Modified | Listado editable, quitar/restaurar y drag-and-drop. |
| `components/dashboard/sitio-venta/preview/runtime-preview.tsx` | Modified | Preview alineado al nuevo contrato. |
| `components/tenant/soporte-content.tsx` | Modified | Runtime alineado al nuevo contrato. |
| `lib/tenant-support.ts` / `lib/tenant.ts` | Modified | Defaults y parsing dejan de operar como fallback excluyente. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migración desde FAQs persistidas como array plano | Med | Definir compatibilidad de lectura y normalización al cargar. |
| IDs inestables rompan reorder o restore | Med | Generar/normalizar ids canónicos para defaults y custom. |

## Rollback Plan

Revertir el nuevo shape FAQ y volver temporalmente al array plano con fallback actual si aparece una regresión crítica en edición o render.

## Dependencies

- Confirmar estrategia de normalización/migración para tenants existentes.

## Success Criteria

- [ ] Las FAQs por defecto se ven dentro del listado editable y pueden quitarse individualmente.
- [ ] Restore defaults repone sólo defaults faltantes y no pisa FAQs custom.
- [ ] Preview y runtime renderizan la misma colección FAQ ordenada y con identidad estable.
- [ ] Reorder drag-and-drop depende de ids/orden persistibles, no de texto o índice.
