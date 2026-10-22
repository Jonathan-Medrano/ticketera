# Tasks: Split Configuración and Sitio de Venta

## Phase 1: Contract Separation

- [x] 1.1 Modificar `backend/src/routes/configuracion.ts` para aceptar y actualizar solo campos internos.
- [x] 1.2 Crear handler backend dedicado para `GET/PATCH` de sitio de venta con whitelist de campos públicos.
- [x] 1.3 Registrar la nueva ruta en `backend/src/routes/index.ts`.

## Phase 2: Frontend Wiring

- [x] 2.1 Modificar `platea/app/api/configuracion/route.ts` para mantener solo configuración interna.
- [x] 2.2 Crear `platea/app/api/sitio-venta/route.ts` como proxy dedicado.
- [x] 2.3 Modificar `platea/components/dashboard/configuracion-content.tsx` para mandar solo payload interno.
- [x] 2.4 Modificar `platea/app/(empresa)/dashboard/sitio-venta/page.tsx` y `platea/components/dashboard/sitio-venta/editor-container.tsx` para leer y guardar contra `/api/sitio-venta`.
- [x] 2.5 Ajustar `page.tsx` de configuración y sitio de venta para consumir contratos separados.

## Phase 3: Verification

- [x] 3.1 Verificar que guardar `Configuración` no modifique campos de sitio de venta.
- [x] 3.2 Verificar que guardar `Sitio de venta` no modifique `nombre`, `email`, `admin_*` ni `comision_revendedor_default`.
- [x] 3.3 Verificar que `PATCH /configuracion/password` siga funcionando sin cambios.
