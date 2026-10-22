# Tasks: Rebuild Product Database

## Phase 1: Foundation / Baseline

- [x] 1.1 Respaldar la DB local actual y documentar en `actualizar db.sql` qué tablas están sanas hoy (`empresas`, `usuarios`, `compradores`, `password_reset_tokens`, `checkout_sessions`).
- [x] 1.2 Auditar `backend/src/routes/configuracion.ts`, `backend/src/routes/tenant.ts` y `platea/auth.ts` para listar columnas faltantes de `empresas` y `usuarios`.
- [x] 1.3 Actualizar `actualizar db.sql` con la ampliación de `empresas` y `usuarios` más la creación de `roles`.

## Phase 2: Core Auth / Tenant Layer

- [x] 2.1 Aplicar el bloque core en la DB local y verificar con SQL que `empresas`, `usuarios`, `compradores` y `roles` quedan accesibles e íntegros.
- [x] 2.2 Validar login empresa y empleado contra `platea/auth.ts` y rutas backend relacionadas.
- [x] 2.3 Validar tenant básico y configuración (`GET /tenant/:slug`, flujos de configuración y forgot/reset) sin errores de tabla o columna faltante.

## Phase 3: Events / Ticketing Schema

- [x] 3.1 Auditar `backend/src/routes/eventos.ts`, `backend/src/routes/entradas.ts`, `dashboard.ts` y `tenant.ts` para derivar DDL de `eventos`, `evento_fechas`, `evento_tandas` y `entrada_categorias`.
- [x] 3.2 Agregar esas tablas a `actualizar db.sql` en un bloque de capa ticketing con índices y claves necesarias.
- [x] 3.3 Auditar y derivar DDL de `entradas` y `login_tokens` desde `entradas.ts`, `compradores.ts`, `tenant.ts` y `escanear.ts`.
- [x] 3.4 Aplicar el bloque ticketing y validar listado público tenant, detalle de evento, dashboard de eventos y consultas de entradas.

## Phase 4: Checkout / Commercial Auxiliaries

- [x] 4.1 Ajustar `checkout_sessions` al schema real requerido por `backend/src/routes/tenant.ts`.
- [x] 4.2 Validar creación, expiración y confirmación de checkout en entorno local sin errores de schema.
- [x] 4.3 Auditar `backend/src/routes/revendedores.ts` y `equipo.ts` para completar comisiones y relaciones faltantes en `usuarios`, `empresas` y `entradas`.

## Phase 5: Consumables Layer

- [x] 5.1 Auditar `backend/src/routes/consumibles.ts`, `barras.ts`, `vender.ts`, `canjear.ts`, `ventas.ts` y `promociones.ts` para derivar el schema completo de consumibles.
- [x] 5.2 Agregar a `actualizar db.sql` las tablas `consumibles`, `barras`, `barra_stock`, `barra_restock_alertas`, `consumibles_promociones`, `consumibles_ventas` y `consumibles_venta_items`.
- [x] 5.3 Aplicar la capa consumibles y validar CRUD, stock, promociones, vender, canjear e historial.

## Phase 6: Verification / Hardening

- [x] 6.1 Ejecutar un checklist manual por capa y registrar qué módulos quedaron navegables y cuáles no.
- [x] 6.2 Verificar que backend y frontend ya no arrojen errores de tabla/columna faltante en los módulos reconstruidos.
- [x] 6.3 Consolidar en `actualizar db.sql` solo lo pendiente real y dejar fuera cualquier artefacto de laboratorio que ya no corresponda.
