# Tasks: Accessible Tooltip System

## Phase 1: Foundation

- [x] 1.1 Crear `components/ui/tooltip.tsx` sobre `radix-ui` con `Provider`, `Trigger`, `Content` y `Portal`, alineando estilos con `dialog.tsx` y `dropdown-menu.tsx`.
- [x] 1.2 Extraer en `components/ui/tooltip.tsx` el gating coarse-pointer con `matchMedia("(hover: hover) and (pointer: fine)")` para que hover/focus tooltip solo exista en desktop fine pointer.
- [x] 1.3 Definir en `components/ui/tooltip.tsx` cierre por blur, pointer leave, `Escape` y activacion del trigger, sin mover foco del control.

## Phase 2: Icon-Only Abstraction

- [x] 2.1 Crear `components/ui/icon-action.tsx` usando `Button` y `buttonVariants`, con `label` obligatorio, `aria-label` siempre aplicado y `tooltip` default igual a `label`.
- [x] 2.2 Implementar en `components/ui/icon-action.tsx` soporte `variant`, `size`, `asChild` y render de links/children para cubrir botones y `Link` icon-only.
- [x] 2.3 Resolver en `components/ui/icon-action.tsx` el caso `disabledReason`: wrapper no disabled focusable solo cuando haya explicacion, manteniendo el control interno `disabled`.
- [x] 2.4 Documentar en el contrato del componente que no debe usarse cuando ya existe texto visible y que no depende de `title`.

## Phase 3: Dashboard Rollout I

- [x] 3.1 Migrar `components/dashboard/sidebar.tsx` para reemplazar `title` en nav items colapsados, logout y toggle desktop por `Tooltip`/`IconAction`, preservando `aria-label` y sin tooltip en mobile.
- [x] 3.2 Migrar paginacion icon-only en `components/dashboard/eventos-content.tsx`, `roles-content.tsx`, `consumibles-content.tsx`, `consumibles-promociones-content.tsx`, `consumibles-ventas-content.tsx`, `entradas-content.tsx`, `equipo-content.tsx`, `compradores-content.tsx` y `revendedores-content.tsx`.
- [x] 3.3 Migrar acciones compactas de fila con `title` en `eventos-content.tsx`, `consumibles-content.tsx`, `consumibles-barras-content.tsx` y `consumibles-promociones-content.tsx` al nuevo wrapper icon-only.
- [x] 3.4 Corregir en `components/dashboard/revendedores-content.tsx` la falta actual de `aria-label` en paginacion y acciones icon-only dentro de la misma adopcion.

## Phase 4: Tenant Rollout I

- [x] 4.1 Migrar `components/tenant/tenant-theme-toggle.tsx` a `IconAction`, manteniendo label accesible segun modo y removiendo `title`.
- [x] 4.2 Aplicar el sistema en `components/tenant/tenant-navbar.tsx` para carrito, mis tickets y logout icon-only; dejar intacto `Ingresar` porque ya tiene texto visible.
- [x] 4.3 Aplicar el sistema en `components/tenant/tenant-home.tsx` para theme toggle, carrito y mis tickets del header fijo; excluir controles no cubiertos por la spec.

## Phase 5: Validation And Regression

- [ ] 5.1 Agregar infraestructura minima de tests de componentes en `package.json` y archivos de config necesarios para RTL, si todavia no existe en el repo.
- [ ] 5.2 Crear tests unitarios para `components/ui/tooltip.tsx` e `icon-action.tsx` cubriendo focus/hover desktop, coarse pointer sin tooltip, `label` accesible y wrapper disabled con explicacion.
- [ ] 5.3 Crear tests de integracion para `components/dashboard/sidebar.tsx`, `components/tenant/tenant-navbar.tsx` y un listado con paginacion icon-only verificando desktop vs mobile/coarse pointer.
- [ ] 5.4 Ejecutar validacion manual del rollout inicial sobre sidebar colapsado, topbars tenant y listados dashboard para `Escape`, blur, activacion click y ausencia de hover UI en touch.
