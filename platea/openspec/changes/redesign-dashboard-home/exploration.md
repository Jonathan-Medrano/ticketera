## Exploration: dashboard home with carousel and event filter

### Current State
`backend/src/routes/dashboard.ts` ya soporta la hipótesis principal: acepta `req.query.evento`, filtra todas las métricas con ese valor, devuelve `eventos` para poblar un selector, expone `eventos_activos` con `id`, `nombre`, `fecha`, `vendidas`, `capacidad` y `kind`, y además devuelve `filtros.evento`. En cambio `app/(empresa)/dashboard/page.tsx` sólo lee `desde` y `hasta`, arma el querystring sin `evento`, tipa una respuesta recortada que no incluye `eventos`, `eventos_activos` ni `filtros`, y le pasa a `DashboardContent` únicamente métricas, gráficos, últimas ventas, próximo evento y período. `components/dashboard/dashboard-content.tsx` hoy renderiza hero, card de próximo evento, filtro por fecha, métricas, tabs analíticas y actividad reciente; no consume la lista de eventos ni ofrece selector de evento ni carrusel de eventos activos. En el repo existe una primitive reusable de select (`components/ui/select.tsx`) y patrones de filtro por evento en `components/dashboard/entradas-content.tsx` y `components/dashboard/compradores-content.tsx`, pero NO existe primitive de carousel ni dependencia instalada para eso (`glob **/*carousel*.tsx` y búsqueda de `embla|keen-slider|swiper` sin resultados). En OpenSpec ya existe el change `redesign-dashboard-home`, pero sus artifacts actuales hablan de un rediseño más amplio de home + sidebar + eventos, con tareas marcadas como completas, y no mencionan carrusel ni filtro por evento; además no hay `openspec/config.yaml` ni `exploration.md` todavía.

### Affected Areas
- `backend/src/routes/dashboard.ts` — ya expone el contrato necesario; define la fuente real para selector de eventos y carrusel de eventos activos.
- `app/(empresa)/dashboard/page.tsx` — debe ampliar `searchParams`, tipado de respuesta y props para empezar a consumir `evento`, `eventos`, `eventos_activos` y `filtros`.
- `components/dashboard/dashboard-content.tsx` — concentra la UI del home; ahí hay que sumar selector por evento, sincronización con querystring y superficie tipo carrusel para eventos activos.
- `components/ui/select.tsx` — primitive existente reutilizable para el filtro de eventos, evitando inventar un control nuevo.
- `components/dashboard/entradas-content.tsx` — referencia concreta del patrón actual de filtro por evento con querystring.
- `components/dashboard/compradores-content.tsx` — segunda referencia de implementación para mantener consistencia del selector por evento.
- `openspec/changes/redesign-dashboard-home/proposal.md` — el alcance actual está corrido hacia sidebar/eventos y no refleja este pedido puntual.
- `openspec/changes/redesign-dashboard-home/design.md` — necesita documentar cómo resolver el carrusel sin primitive existente.
- `openspec/changes/redesign-dashboard-home/tasks.md` — hoy está cerrado sobre otro alcance y no contempla el trabajo nuevo de carrusel + filtro.
- `openspec/changes/redesign-dashboard-home/specs/dashboard-home-redesign/spec.md` — debe formalizar el consumo de `eventos_activos` y el filtro por evento en el home.

### Approaches
1. **Extender el home actual con carrusel liviano propio**
   - Pros: reutiliza el backend existente sin tocar contratos; aprovecha `Select` y patrones ya usados en otras pantallas; evita dependencias nuevas; mantiene el cambio acotado al home.
   - Cons: el carrusel habría que implementarlo a mano (scroll-snap + controles + estado accesible); requiere ajustar tipados y props en SSR/Client boundary.
   - Effort: Medium

2. **Introducir una primitive formal de carousel antes del rediseño**
   - Pros: deja una base reutilizable para futuras superficies con sliders y cards destacadas.
   - Cons: hoy no existe primitive ni dependencia; agrega alcance de infraestructura UI; choca con el espíritu del change actual de no cambiar contratos ni sumar complejidad innecesaria.
   - Effort: High

### Recommendation
Conviene ir con la opción 1: mantener `backend/src/routes/dashboard.ts` tal como está, ampliar `app/(empresa)/dashboard/page.tsx` para consumir el contrato completo y resolver en `DashboardContent` un selector por evento usando la primitive `Select` existente más un carrusel liviano propio para `eventos_activos`. Es la ruta más alineada con el código real: el dato YA existe, el filtro YA está soportado end-to-end en backend, y lo único ausente es el consumo frontend y la composición visual. Antes de aplicar, la proposal/spec/design del change deberían reencuadrarse porque hoy describen otro alcance y dan por terminado trabajo que no cubre este pedido.

### Risks
- El change actual está desalineado con el pedido nuevo; si no se actualizan proposal/spec/tasks, la implementación quedaría fuera de contrato.
- Un carrusel custom puede degradar accesibilidad o responsive si no se define navegación, snapping y fallback estático con cuidado.
- `proximo_evento` hoy sale del primer item de `eventos_activos`; si además se muestra un carrusel, hay riesgo de duplicar el mismo mensaje arriba y en la tira de eventos.
- El filtro por `evento` afecta métricas, gráficos, últimas ventas y eventos activos; si la UI no hace evidente ese alcance, puede parecer que el filtro “rompe” información.

### Ready for Proposal
Yes — hay evidencia suficiente para pasar a proposal, pero la proposal del change debe actualizarse para enfocarse en home + carrusel + filtro por evento y dejar explícito que no existe primitive de carousel lista para usar.
