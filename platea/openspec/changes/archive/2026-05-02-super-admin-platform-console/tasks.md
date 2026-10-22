# Tasks: Super Admin Platform Console

## Phase 1: Identidad super-admin y storage owner-controlled por empresa

- [x] 1.1 Definir y aplicar en `actualizar db.sql` el modelo persistido para reconocer cuentas super-admin internas sin alta pública.
- [x] 1.2 Adaptar el flujo de autenticación/sesión para resolver `super_admin` desde el mismo login general, sin romper empresa/empleado/comprador.
- [x] 1.3 Crear storage persistido para la comisión marketplace por empresa (`empresa_marketplace_fees` o equivalente) con trazabilidad mínima de actualización.
- [x] 1.4 Mantener una estrategia de fallback/migración desde la config actual basada en env para evitar romper el checkout durante la transición.

## Phase 2: Backend owner-only y fee por empresa

- [x] 2.1 Modificar `backend/src/lib/marketplace-fee.ts` para resolver la comisión desde persistencia por empresa en vez de env global.
- [x] 2.2 Ajustar `backend/src/lib/sales-readiness.ts` para seguir considerando fee resoluble por empresa bajo el nuevo storage.
- [x] 2.3 Crear endpoints backend owner-only para dashboard global, listado de empresas, detalle de ganancias por empresa y update de comisión por empresa.
- [x] 2.4 Asegurar que usuarios no super-admin reciban rechazo estable al intentar acceder a esos endpoints.
- [x] 2.5 Crear backend owner-only para ver/actualizar la cuenta Mercado Pago del owner, reutilizando primitives de cifrado sin mezclar seller accounts tenant.

## Phase 3: Consola frontend super-admin

- [x] 3.1 Crear una superficie frontend separada para super-admin (`app/(super-admin)` o equivalente) con layout propio.
- [x] 3.2 Construir el dashboard principal del owner con métricas agregadas y gráficos de ganancias.
- [x] 3.3 Construir el listado de empresas con columnas comerciales relevantes y acceso a modal por empresa.
- [x] 3.4 Implementar el modal de ganancias por empresa con métricas owner-oriented y serie temporal si aplica.
- [x] 3.5 Implementar UI para configurar comisión por empresa desde la consola global.
- [x] 3.6 Implementar UI/settings para la cuenta Mercado Pago del owner.

## Phase 4: Integración con el flujo comercial actual

- [x] 4.1 Verificar que el checkout existente use la nueva comisión persistida por empresa sin cambios de comportamiento no deseados.
- [x] 4.2 Verificar que el dashboard empresa siga viendo la comisión como read-only y nunca editable.
- [x] 4.3 Verificar que una empresa sin comisión resoluble quede no-vendible de forma explícita bajo el nuevo modelo persistido.

## Phase 5: Verificación

- [x] 5.1 Escribir tests para autenticación/autorización del super-admin y protección de rutas owner-only.
- [x] 5.2 Escribir tests para la resolución de comisión por empresa y su impacto en readiness/checkout.
- [x] 5.3 Escribir tests para dashboard global, listado de empresas y detalle/modal por empresa.
- [x] 5.4 Escribir tests para la cuenta Mercado Pago del owner y su aislamiento respecto a seller accounts tenant.
- [ ] 5.5 Validar manualmente el flujo owner completo: login general como super-admin, dashboard, listado, modal, update fee y settings MP owner.

### Evidencia Phase 1

- `actualizar db.sql` ahora define `platform_admin_users` y `empresa_marketplace_fees`.
- `platea/auth.ts`, `platea/auth.config.ts`, `platea/types/next-auth.d.ts` y `backend/src/types.ts` ya reconocen `super_admin` desde el login general.
- `backend/src/lib/marketplace-fee.ts` migró a resolución por empresa con fallback transitorio a env para rollout seguro.
- Verificación ejecutada sin build: `npm test` en `backend/` → `20/20` pasando.

### Evidencia Phase 2

- Backend owner-only agregado en `backend/src/routes/platform.ts` con dashboard global, listado de empresas, detalle de ganancias por empresa, update de comisión por empresa y settings de cuenta MP owner.
- `backend/src/lib/platform-owner-payment-account.ts` persiste y valida la cuenta Mercado Pago del owner sin tocar seller accounts tenant.
- `backend/src/routes/index.ts` registra la nueva superficie `/platform`.
- Test de integración agregado: `platform routes protect owner-only access and expose dashboard, companies, fee update and owner payment account`.
- Verificación ejecutada sin build: `npm test` en `backend/` → `20/20` pasando.

### Evidencia Phase 3

- Se creó la superficie frontend `/super-admin` con layout propio en `app/(super-admin)/super-admin/*`.
- `components/super-admin/platform-console.tsx` implementa dashboard global, tabla de empresas, modal de ganancias por empresa, edición de comisión y settings de cuenta MP owner.
- `components/super-admin/sidebar.tsx` crea navegación owner diferenciada del dashboard tenant.
- `app/(marketing)/login/page.tsx` ahora redirige al owner a `/super-admin` después del login general.
- Se agregaron proxies Next para `/api/platform/*` usados por la consola global.
- Verificación específica frontend tocado: `npx eslint ...` sobre los archivos nuevos/modificados sin errores.

### Evidencia Phase 4

- `backend/src/mercadopago-gating.test.ts` ahora cubre que la comisión marketplace persistida por empresa overridea el fallback de env en lecturas tenant-facing.
- La integración sigue preservando el dashboard empresa en modo read-only para la comisión y el readiness continúa dependiendo de fee resoluble + seller account.
- Verificación ejecutada sin build: `npm test` en `backend/` → `22/22` pasando.

### Evidencia Phase 5

- `backend/src/mercadopago-gating.test.ts` ahora cubre rechazo explícito de acceso owner-only para empresa y empleado, update fee por super-admin, owner payment account aislada y dataset del dashboard owner.
- `platea/auth-identities.test.ts` cubre la resolución del login general para `super_admin` y garantiza que una cuenta pública de empresa no escale a owner.
- Verificaciones automatizadas ejecutadas sin build:
  - `npm test` en `backend/` → `22/22` pasando.
  - `npx tsx --test auth-identities.test.ts` en `platea/` → `2/2` pasando.
  - `npx eslint "auth.ts" "auth.config.ts" "types/next-auth.d.ts" "lib/auth-identities.ts"` → sin errores.
