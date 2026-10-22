# Design: Redesign Sitio de Venta Editor

## Technical Approach

Se mantiene `app/(empresa)/dashboard/sitio-venta/page.tsx`, el form único en `editor-container.tsx`, el draft local y `PATCH /api/sitio-venta`. El cambio es editorial y estructural: pasar de una pantalla con bloques co-iguales a un flujo **task-first** con una sola tarea principal visible por vez. `editor-container`, `editor-shell`, `section-primitives` y `runtime-preview` se reorganizan para priorizar secuencia de lectura, peso visual proporcional por dominio y previews secundarios, concretos y no invasivos.

## Architecture Decisions

### Decision: Shell task-first, no tablero de bloques

| Option | Tradeoff | Decision |
|---|---|---|
| Mantener toolbar + canvas + preview como pares visuales | Conserva la composición actual, pero deja múltiples focos simultáneos | Rejected |
| Usar toolbar sobria + subnav + canvas dominante único | Exige reordenar composición y copy, pero clarifica la acción principal | Chosen |

Rationale: la spec exige una sola tarea principal por dominio y menor carga cognitiva.

### Decision: Formularios agrupados por prioridad editorial

| Option | Tradeoff | Decision |
|---|---|---|
| Mantener todas las secciones actuales como bloques equivalentes | Reusa primitives existentes, pero obliga a escanear demasiado | Rejected |
| Ordenar cada dominio en pasos: base → opcionales → referencia | Requiere refactor de primitives y layout, pero mejora comprensión | Chosen |

Rationale: el problema detectado es jerarquía mala, no falta de información.

### Decision: Preview de apoyo, no de exhibición

| Option | Tradeoff | Decision |
|---|---|---|
| Mantener previews grandes y demostrativos dentro de cada sección | Hace visible el resultado, pero duplica pantallas y ruido | Rejected |
| Reemplazar previews pesados por referencias compactas, contextuales y comparables | Exige curar mejor qué mostrar, pero baja la sobrecarga | Chosen |

Rationale: la validación visual debe acompañar la decisión activa y no distraer de ella.

### Decision: Peso visual proporcional por dominio

| Option | Tradeoff | Decision |
|---|---|---|
| Aplicar el mismo patrón visual fuerte a los 4 dominios | Consistencia superficial, pero desperdicia atención | Rejected |
| Dar más densidad a `Identidad` y `Home/Eventos`, compactar `Consumibles` y `Soporte` | Requiere variantes de composición, pero respeta alcance real | Chosen |

Rationale: la spec nueva exige que dominios de bajo alcance no imiten la densidad de los complejos.

## Data Flow

`SitioVentaPage` carga `empresa`, `eventosPreview` y `consumiblesPreview` sin cambiar fetch ni contratos.

`SitioVentaEditorContainer`
→ conserva `form`, dirty state, draft y save
→ define `activeDomain`
→ compone un `domainItems[]` más curado: cada dominio entrega `summary`, `primaryFields`, `secondaryFields`, `contextPreview`
→ entrega a `SitioVentaEditorShell` una sola superficie activa
→ el shell renderiza: header liviano → navegación → canvas principal → preview secundario opcional
→ `serializeSitioVentaPayload(form)` mantiene el payload actual

```text
SitioVentaPage
   │
   └──→ SitioVentaEditorContainer
            │
            ├── form / dirty / save
            ├── activeDomain
            └── domain config
                    │
                    └──→ SitioVentaEditorShell
                             ├── primary editorial canvas
                             └── contextual preview block
```

Por dominio:
- `Identidad y Colores`: marca pública, URL y assets viven en una sola narrativa; branding deja de repartirse en sub-bloques con igual peso.
- `Home/Eventos`: secuencia obligatoria `layout → visibilidad → copy → referencia visual`; los ejemplos internos pesados dejan de competir con `runtime-preview.tsx`.
- `Consumibles`: pasa a estado/resumen editorial compacto con una referencia visual mínima.
- `Soporte`: contacto + FAQs ordenables con menos wrappers y menor densidad visual.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/redesign-sitio-venta-editor/design.md` | Modify | Reenfocar el diseño hacia simplificación radical task-first. |
| `components/dashboard/sitio-venta/editor-container.tsx` | Modify | Recurar toolbar, summary y composición de `domainItems` con preview/contexto separado del bloque principal. |
| `components/dashboard/sitio-venta/editor-shell.tsx` | Modify | Implementar shell con canvas dominante, summary liviano y layout proporcional por dominio. |
| `components/dashboard/sitio-venta/section-primitives.tsx` | Modify | Crear primitives más sobrias para grupos, helpers, choices y ejemplos compactos; relajar `SectionCard`. |
| `components/dashboard/sitio-venta/sections/identidad-section.tsx` | Modify | Unificar identidad, URL, branding y assets en una secuencia única más fácil de leer. |
| `components/dashboard/sitio-venta/sections/home-section.tsx` | Modify | Reordenar `Home/Eventos` por prioridad y reducir densidad de decisiones simultáneas. |
| `components/dashboard/sitio-venta/sections/consumibles-section.tsx` | Modify | Rehacerlo como resumen/estado editorial compacto. |
| `components/dashboard/sitio-venta/sections/soporte-section.tsx` | Modify | Compactar contacto y FAQs con menos wrappers fuertes. |
| `components/dashboard/sitio-venta/preview/runtime-preview.tsx` | Modify | Rediseñar previews como referencias compactas, subordinadas y específicas por dominio. |

## Interfaces / Contracts

No cambian `EditorDomain`, `SitioVentaForm`, `DOMAIN_FIELD_OWNERSHIP`, `serializeSitioVentaPayload`, endpoints ni persistencia.

Se permite introducir configuración interna de presentación para la shell, sin persistencia nueva, por ejemplo:

```ts
type DomainCanvasConfig = {
  summary?: React.ReactNode
  form: React.ReactNode
  preview?: React.ReactNode
  density: "full" | "compact"
}
```

Esto vive en el editor y NO altera el payload ni el contrato backend.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `model.ts` y payload | Confirmar que ownership, dirty map, draft y save no cambian. |
| Unit | Builders de `runtime-preview.tsx` | Verificar un solo preview principal en `Home/Eventos` y previews compactos en dominios menores. |
| Integration | `editor-container` + `editor-shell` | Validar cambio de dominio, persistencia de draft y guardado sin regresiones. |
| Integration | `identidad/home/consumibles/soporte` sections | Validar que cada dominio renderiza orden y densidad correctos sin perder controles existentes. |
| Manual | UX/UI editorial | Revisar foco principal, legibilidad móvil, peso visual proporcional y ausencia de doble pantalla percibida. |

## Migration / Rollout

No hay migración. Rollout en tres pasos: 1) shell y primitives nuevas; 2) reordenamiento de `Identidad` y `Home/Eventos`; 3) compactación de `Consumibles`/`Soporte` y ajuste final de previews. Si una etapa confunde el flujo, rollback visual por archivo sin tocar negocio ni persistencia.

## Open Questions

- [ ] Ninguna bloqueante de negocio; durante implementación habrá que decidir si algunos helpers textuales pasan a accordions/footnotes para bajar ruido sin perder claridad.
