# Proposal: Sitio de venta — plantillas, bloques libres y diferenciación (v2+)

## Intent

El 14-jul-2026 se lanzó la v1 (beta) del nuevo editor de sitio de venta: pestaña propia, navbar (volver/guardar/opciones), sidebar de secciones y preview 100% en vivo vía `postMessage` sobre el `TenantProvider` real. Esa v1 reorganizó el *contenedor* pero deliberadamente NO tocó los formularios de sección existentes ni agregó plantillas propias ni bloques libres — quedó explícito como v2/v3 en el diseño original.

El founder confirmó (14-jul) que la sección sigue en beta y pidió reestructurarla hasta "hacerla perfecta", con foco explícito en **diferenciarse al máximo** de la competencia (hoy percibida como "una copia de tuplatea"). Este proposal cubre esa continuación: sistema de plantillas guardables, edición de bloques/secciones libres (hoy el set de tipos de sección está cerrado a 5 tipos hardcodeados), y una pasada de diferenciación visual/UX real.

## Scope

### In Scope
- Sistema de plantillas propias: guardar el estado actual del sitio como plantilla nombrada, aplicarla, listarla, borrarla — a nivel tenant (no solo los 5 presets de color hardcodeados que ya existen).
- Editor de bloques libres para el home: agregar/quitar/reordenar secciones más allá de los 5 tipos cerrados actuales (`eventos`, `banner`, `galeria`, `banners_group`, `auspiciantes_carousel`), con un catálogo de bloques nuevos (texto libre, video embed, mapa/ubicación, countdown de evento, testimonios).
- Pasada de diferenciación visual/UX: auditoría explícita contra el patrón "copia de tuplatea" y rediseño de los elementos más genéricos, apalancando el preview en vivo ya construido para iterar rápido.
- Persistencia de UX menor pendiente de v1 (`activeSection` no persiste en localStorage, a diferencia del viejo `activeTab`).
- Migrar los entry points secundarios (`primeros-pasos-card.tsx`, `lib/victoria/knowledge.ts`) a abrir el editor en pestaña nueva, consistente con el sidebar principal.

### Out of Scope
- Reescribir el modelo de datos de `Empresa` (columnas planas + JSON híbrido) — las plantillas y bloques nuevos se construyen sobre el contrato actual de `SitioVentaForm`/`buildSitioVentaPayload`, no se migra a un schema nuevo en este ciclo.
- Editor de bloques 100% "drag-and-drop desde cero" tipo Webflow/Framer — se extiende `SectionsOrderManager` (ya soporta reorder vía dnd-kit), no se reconstruye el mecanismo de drag-and-drop.
- Marketplace de plantillas entre tenants (plantillas compartidas/curadas globalmente por TICKETERA) — v1 de plantillas es por-tenant únicamente; una versión curada/compartida queda para un ciclo posterior si hay demanda.
- Reels/video generado — fuera del alcance de esta superficie.

## Capabilities

### New Capabilities
- `sitio-venta-plantillas-guardables`: guardar/aplicar/listar/borrar plantillas propias del tenant (tema + estructura de secciones, no solo color).
- `sitio-venta-bloques-libres`: catálogo extendido de tipos de bloque para el home (texto libre, video embed, mapa, countdown, testimonios), integrado al `SectionsOrderManager` existente.
- `sitio-venta-diferenciacion-visual`: auditoría + rediseño de los patrones más genéricos del sitio público (`t/[tenant]/*`) para alejarse del look "copia de ticketera genérica".

### Modified Capabilities
- `sitio-venta-editor-shell` (v1, recién lanzada): agrega persistencia de `activeSection`, integra el nuevo panel de plantillas al sidebar.
- `sections-order-manager`: extiende el catálogo de tipos de bloque más allá de los 5 actuales.

## Approach

Se construye en 3 fases independientes y liberables por separado (cada una es una beta usable sin depender de que las otras estén terminadas):

**Fase A — Plantillas guardables.** Nueva tabla `EmpresaSitioTemplate` (Prisma) con `empresa_id`, `nombre`, `snapshot` (JSON — mismo shape que `SitioVentaForm`, no un formato nuevo), `created_at`. UI: botón "Guardar como plantilla" en el navbar del editor (junto a Guardar), lista de plantillas guardadas en un panel nuevo del sidebar, aplicar = mergear el snapshot sobre el `form` actual (mismo mecanismo que ya usa `aplicarPlantilla()` para los 5 presets hardcodeados, generalizado). El preview en vivo ya construido en v1 hace que aplicar una plantilla sea instantáneamente visible antes de guardar — no hace falta ningún mecanismo nuevo de preview.

**Fase B — Bloques libres.** Extender `home_sections` (hoy JSON con 5 tipos cerrados) con un discriminated union más grande. Cada bloque nuevo (texto libre, video embed, mapa, countdown, testimonios) es un componente de sección nuevo en `components/tenant/` (renderizado público) + su editor correspondiente en `components/dashboard/sitio-venta/` (mismo patrón que ya siguen `TenantHomeBannersGroupCarousel`/`SectionsOrderManager`). El drag-and-drop y el sistema de expandir/colapsar de `SectionsOrderManager` se reusan tal cual — solo crece el catálogo de tipos.

**Fase C — Diferenciación visual.** Auditoría dirigida (agente de diseño/UX) sobre `t/[tenant]/*` comparando contra el patrón genérico de ticketeras del mercado (sin acceso directo a tuplatea, pero sí contra los hallazgos ya documentados en `COMPETENCIA-IG.md`/investigación de mercado si existe), identificando qué elementos leen como "template de ticketera default" (layout de cards, tipografía por defecto, disposición del hero) y proponiendo variantes realmente distintivas — apalancando que ahora el preview en vivo permite iterar visualmente rápido sin ciclos de guardado/espera.

**Estado de Fase C (14-jul-2026): los 5 hallazgos de la auditoría de diferenciación visual quedaron resueltos**, 3 con cambio directo y 2 subsumidos por el mismo cambio estructural (nota: el listado original de la auditoría no vive como documento committeado en este repo; el estado de abajo está verificado contra código, no contra el reporte original):
- **Banners/hero** (2 hallazgos) — resuelto directo: `banner_variant` (`blurred`/`full`) + `getTenantHeroVisualTokens` (`platea/lib/tenant-hero-preview.ts`) dan al hero un tratamiento visual configurable, no el banner-slider genérico de cualquier page-builder.
- **Eje estructural de theming de las cards de evento** (1 hallazgo) — resuelto vía `event_card_style` (`clasico`/`editorial`, `platea/lib/tenant-home-sections.ts` + render en `platea/components/tenant/tenant-home.tsx`): el layout editorial (imagen a sangre, overlay, texto superpuesto) es lo que aleja la card default de "template de ticketera".
- **Variante de card** (1 hallazgo) — en la práctica queda cubierto por el mismo `event_card_style`: no hay un eje de diferenciación de card independiente del ya resuelto arriba.
- **Testimonios anclados a un evento pasado real** (1 hallazgo, este ciclo) — resuelto: `evento_id` opcional en `TenantHomeTestimonioItem` (`platea/lib/tenant-home-sections.ts`), selector "Vincular a un evento" en el editor (`platea/components/dashboard/sitio-venta/sections-order-manager.tsx`) limitado a eventos pasados/finalizados del tenant (`GET /api/eventos?basic=1&solo_pasados=1`), y render público con imagen de portada + nombre del evento reemplazando el avatar genérico (`platea/components/tenant/tenant-home-testimonios-section.tsx`) — resuelto server-side y con fallback gracioso si el evento fue borrado, sin requerir ninguna migración de DB (vive dentro del JSON `home_sections`).

## Affected Areas

| Area | Impact | Description |
|------|--------|--------------|
| `backend/prisma/schema.prisma` | New | Tabla `EmpresaSitioTemplate` |
| `backend/src/routes/sitio-venta.ts` (o nueva ruta `sitio-venta-templates.ts`) | New | CRUD de plantillas por empresa |
| `platea/components/dashboard/sitio-venta-editor-shell.tsx` | Modified | Persistencia de `activeSection`, integración del panel de plantillas |
| `platea/components/dashboard/sitio-venta/` | New/Modified | Panel de plantillas, editores de los bloques nuevos |
| `platea/components/tenant/` | New | Componentes públicos de los bloques nuevos (texto libre, video, mapa, countdown, testimonios) |
| `platea/lib/tenant-home-sections.ts` | Modified | Discriminated union extendido de `home_sections` |
| `platea/lib/tenant-preview-override.ts` | Modified | El mapper de preview debe cubrir los campos nuevos de plantillas/bloques |
| `platea/components/dashboard/primeros-pasos-card.tsx`, `platea/lib/victoria/knowledge.ts` | Modified | Abrir el editor en pestaña nueva, consistente con el sidebar |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bloques nuevos rompen el mapper de preview en vivo (v1) si no se actualiza en simultáneo | High | `tenant-preview-override.ts` se extiende en el mismo PR que cada bloque nuevo, nunca después |
| Plantillas con snapshots viejos quedan desalineadas si `SitioVentaForm` cambia de forma en el futuro | Med | Versionar el snapshot (`schema_version` en la tabla) y migrar/ignorar campos desconocidos al aplicar, nunca crashear |
| Auditoría de diferenciación (Fase C) se vuelve subjetiva sin criterio objetivo | Med | Anclarla a datos reales (qué convierte mejor, benchmarks de `METRICAS.md`/`COMPETENCIA-IG.md`), no solo gusto estético |
| Catálogo de bloques crece sin límite y complica el `SectionsOrderManager` | Low | Mantener cada bloque nuevo detrás del mismo patrón expandible que ya existe, sin tocar el mecanismo de drag-and-drop |

## Rollback Plan

Cada fase es independiente y reversible por separado: Fase A (plantillas) puede desactivarse ocultando el panel del sidebar sin afectar el resto del editor; Fase B (bloques nuevos) puede desactivarse quitando los tipos nuevos del catálogo sin romper `home_sections` existentes (los tenants que ya usaron un bloque nuevo simplemente dejan de poder agregar otro, no se rompe lo guardado); Fase C es solo CSS/componentes visuales, revertible por PR.

## Dependencies

- v1 del editor (pestaña/navbar/sidebar/preview en vivo) — **ya implementada y verificada (14-jul-2026)**, es la base sobre la que se construye todo esto.
- `tenant-preview-override.ts` y el listener de `TenantProvider` (v1) — cualquier campo nuevo de plantillas/bloques tiene que sumarse ahí para que el preview en vivo los refleje.

## Suggested Phases

1. **Fase A — Plantillas guardables** (mayor prioridad: es la deuda más directa que dejó v1 explícitamente marcada como "queda para v2").
2. **Fase B — Bloques libres** (mayor esfuerzo técnico: requiere componentes públicos nuevos + discriminated union extendido).
3. **Fase C — Diferenciación visual** (puede correr en paralelo a A/B una vez que el preview en vivo esté siendo usado activamente — es más una auditoría + iteración de diseño que una feature nueva). **Sustancialmente completa (14-jul-2026)** — ver "Estado de Fase C" en el Approach.

## Success Criteria

- [ ] Un dueño de empresa puede guardar el estado actual de su sitio como plantilla nombrada, y aplicarla después (a su propio tenant) viendo el resultado reflejado al instante en el preview en vivo antes de guardar.
- [ ] El home admite al menos 2 tipos de bloque nuevos (de la lista: texto libre, video embed, mapa, countdown, testimonios) además de los 5 actuales, editables y reordenables con el mismo `SectionsOrderManager`.
- [x] Existe un criterio documentado y aplicado de qué hace que el sitio se vea "genérico de ticketera" vs. distintivo de TICKETERA, con al menos un cambio visual real aplicado a partir de esa auditoría (ver "Estado de Fase C" en el Approach — banners/hero, `event_card_style`, testimonios anclados a evento).
- [ ] `activeSection` persiste entre sesiones del editor (paridad con el comportamiento que tenía `activeTab` en la versión pre-v1).
- [ ] Los 2 entry points secundarios abren el editor en pestaña nueva, consistente con el sidebar principal.
