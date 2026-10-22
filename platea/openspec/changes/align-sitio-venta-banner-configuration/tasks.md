# Tasks: Align Sitio de Venta Banner Configuration

## Phase 1: Canonical contract and draft ownership

- [x] 1.1 Ajustar `components/dashboard/sitio-venta/model.ts` para dejar explícito que `banners` es la fuente canónica del hero y que `imagen_hero`, `imagen_footer` y `footer_texto` quedan eliminados del contrato soportado.
- [x] 1.2 Revisar `createInitialSitioVentaForm`, `sanitizeDraft` y `serializeSitioVentaPayload` en `components/dashboard/sitio-venta/model.ts` para preservar `banner_variant`/`banners` sin shapes paralelos ni soporte residual para `imagen_hero`.
- [x] 1.3 Extender `components/dashboard/sitio-venta/model.test.ts` con casos de normalización, draft y serialización que prueben ownership explícito de `banners` y la ausencia contractual de `imagen_hero`, `imagen_footer` y `footer_texto`.

## Phase 2: Editor split de identidad y branding

- [x] 2.1 Reexponer en `components/dashboard/sitio-venta/sections/identidad-section.tsx` el control visible de `banner_variant` (`blurred` | `full`) conectado directo a `form.banner_variant`.
- [x] 2.2 Reexponer en `components/dashboard/sitio-venta/sections/identidad-section.tsx` la edición de `banners: string[]` con copy canónico de hero y sin reintroducir `imagen_hero`.
- [x] 2.3 Ajustar el copy/estado visual del editor para que el hero quede representado solo por `banners` y no se reexpongan campos legacy de cierre/footer.

## Phase 3: Backend strict validation

- [x] 3.1 Endurecer `backend/src/routes/sitio-venta.ts` para aceptar `banner_variant` solo cuando sea `blurred` o `full`, respondiendo `400` ante cualquier otro valor sin fallback silencioso.
- [x] 3.2 Endurecer `backend/src/routes/sitio-venta.ts` para aceptar `banners` solo como `string[]` válido, rechazando non-array, items incompatibles o normalizaciones parciales con `400`.
- [x] 3.3 Agregar cobertura automatizada del route si ya existe patrón en backend; si no existe infraestructura equivalente, documentar una verificación manual focalizada de PATCH inválido en este cambio.

## Phase 4: Preview/runtime alignment and regression

- [x] 4.1 Verificar `components/dashboard/sitio-venta/preview/runtime-preview.tsx` para que el hero preview siga resolviendo solo desde `banners` + `banner_variant`; hacer ajuste mínimo solo si detectás una lectura alternativa.
- [x] 4.2 Verificar `lib/tenant-hero-preview.ts` y `components/tenant/tenant-home.tsx` para evitar regresión hacia cualquier fuente alternativa al contrato `banners` + `banner_variant` y remover cierre/footer legacy del runtime público.
- [x] 4.3 Extender `lib/tenant-hero-preview.test.ts` con escenarios que demuestren que preview/runtime comparten la fuente canónica del hero.
- [ ] 4.4 Ejecutar smoke razonable del flujo real: editar variante + banners en dashboard, previsualizar, guardar, recargar y contrastar contra runtime público del tenant; registrar cualquier gap restante del contrato.
