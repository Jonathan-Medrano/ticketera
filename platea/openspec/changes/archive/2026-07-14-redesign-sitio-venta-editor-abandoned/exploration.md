## Exploration: redesign-sitio-venta-editor-v2

### Current State
La base funcional del editor está sana: `editor-container.tsx` conserva draft local, dirty state por dominio, guardado único y warnings de slug sin mezclar negocio nuevo. El problema es VISUAL y de FLUJO. Hoy la pantalla sigue cargada porque toolbar, avisos, tabs, cards, ayudas, ejemplos y preview compiten casi con el mismo peso.

`editor-shell.tsx` ya redujo wrappers, pero todavía no expresa una tarea principal con suficiente claridad. `section-primitives.tsx` concentra gran parte de la fricción: repite `SectionCard`, bloques informativos, helpers y mini previews que multiplican la jerarquía visual. `runtime-preview.tsx` está alineado al runtime real, pero sigue sintiéndose como una segunda pantalla dentro del editor en vez de una referencia puntual.

Los dominios no tienen el mismo nivel de complejidad y sin embargo hoy reciben tratamientos parecidos. `Home/Eventos` es el más cargado; `Consumibles` y `Soporte` están sobrepresentados para el alcance que realmente tienen.

### Affected Areas
- `components/dashboard/sitio-venta/editor-container.tsx` — concentra toolbar, estados y composición de dominios; hoy genera demasiados focos simultáneos.
- `components/dashboard/sitio-venta/editor-shell.tsx` — la navegación existe, pero la jerarquía entre subnav, canvas y contenido activo todavía puede simplificarse más.
- `components/dashboard/sitio-venta/section-primitives.tsx` — principal origen de sobrecarga: cards repetidas, ejemplos internos, toggles densos y ayudas con peso similar.
- `components/dashboard/sitio-venta/sections/identidad-section.tsx` — mezcla marca, URL, branding y assets como bloques separados en vez de una historia editorial simple.
- `components/dashboard/sitio-venta/sections/home-section.tsx` — agrupa demasiadas decisiones juntas sin una secuencia clara de prioridad.
- `components/dashboard/sitio-venta/sections/consumibles-section.tsx` — usa una UI demasiado elaborada para una superficie básicamente informativa.
- `components/dashboard/sitio-venta/sections/soporte-section.tsx` — FAQs y contacto tienen fricción visual/operativa mayor a la necesaria.
- `components/dashboard/sitio-venta/preview/runtime-preview.tsx` — preview útil pero todavía invasivo y formalmente co-igual al formulario.
- `openspec/changes/redesign-sitio-venta-editor/*` — el cambio actual habla de flattening, pero hace falta redefinirlo como simplificación radical de lectura y comprensión.

### Approaches
1. **Pulido incremental del layout actual** — bajar intensidad visual, retocar copy y suavizar el preview.
   - Pros: menor riesgo, preserva estructura actual.
   - Cons: probablemente no elimine la sensación de pantalla pesada ni la mala priorización.
   - Effort: Medium

2. **Rediseño por tarea principal** — un canvas dominante por dominio, preview integrado como referencia secundaria, grupos de campos por prioridad y opciones avanzadas colapsables.
   - Pros: ataca la carga cognitiva de raíz, mejora comprensión, hace más simple mobile y permite diferenciar dominios complejos de dominios livianos.
   - Cons: exige repensar primitives, orden y narrativa de edición; no alcanza con cambiar estilos.
   - Effort: High

3. **Editor + preview fijo en split layout** — dos columnas permanentes para editar y ver resultado a la vez.
   - Pros: feedback visual inmediato.
   - Cons: refuerza el problema de “doble pantalla”, complica mobile y vuelve a cargar la composición.
   - Effort: High

### Recommendation
Seguir con **Rediseño por tarea principal**.

La dirección visual recomendada es **editorial utilitaria, sobria y muy intencional**: una sola superficie fuerte, subnavegación liviana, grupos de campos orientados a decisiones reales, preview secundario y contextual, y menos texto explicativo compitiendo con la acción.

Eso implica:
- convertir `Identidad` en una historia única de marca pública;
- convertir `Home/Eventos` en una secuencia simple: layout → visibilidad → copy → referencia visual;
- compactar `Consumibles` como estado/resumen y no como pseudo editor;
- convertir `Soporte` en formulario + FAQs ordenables con menos ruido;
- reemplazar ejemplos genéricos pesados por referencias más concretas, pequeñas y comparables.

El problema NO es falta de “diseño lindo”; es mala jerarquía, exceso de superficies y demasiadas decisiones visibles al mismo tiempo.

### Risks
- Simplificar demasiado y perder señales de ownership por dominio.
- Hacer solo flattening cosmético sin bajar la carga cognitiva real.
- Mantener un mismo patrón visual para dominios con complejidad distinta.
- Seguir apoyándose en demasiados estilos inline y previews redundantes, rompiendo coherencia.

### Ready for Proposal
Yes — hay evidencia suficiente para avanzar a una proposal v2 enfocada en simplificación radical de jerarquía, formularios, previews y organización, sin tocar negocio, payloads ni contratos existentes.
