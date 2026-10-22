# Tasks: Owner-Controlled Mercado Pago OAuth

## Phase 1: Separar dominio de fee owner-controlled

- [x] 1.1 Actualizar el storage para que `empresa_payment_accounts` deje de ser la fuente de verdad de `marketplace_fee`, manteniendo solo la conexión de la cuenta de la empresa.
- [x] 1.2 Crear o adaptar una fuente owner-controlled para la comisión marketplace (`tabla propia` o `config interna`), legible por backend pero no editable por tenant.
- [x] 1.3 Modificar `backend/src/lib/marketplace-fee.ts` para resolver la comisión desde la fuente owner-controlled y no desde `getPaymentAccountReadModelByEmpresaId()`.
- [x] 1.4 Ajustar `backend/src/lib/sales-readiness.ts` para requerir conexión Mercado Pago válida y fee resoluble antes de declarar `ready_to_sell`.

## Phase 2: Implementar flujo OAuth company-scoped

- [x] 2.1 Diseñar helpers/backend para construir la URL OAuth de Mercado Pago con `state` verificable por empresa.
- [x] 2.2 Agregar endpoint `POST /api/cobros/mercadopago/oauth/start` en `backend/src/routes/cobros.ts`.
- [x] 2.3 Agregar endpoint `GET /api/cobros/mercadopago/oauth/callback` en `backend/src/routes/cobros.ts` para intercambiar `code` por credenciales y persistir la conexión.
- [x] 2.4 Adaptar `backend/src/lib/payment-accounts.ts` para guardar metadata OAuth de la empresa (token(s), masked identity, timestamps, estado) sin exponer secretos en read-models.
- [x] 2.5 Agregar `DELETE /api/cobros/mercadopago` para desconectar la cuenta de la empresa y recalcular readiness.

## Phase 3: Reemplazar configuración manual tenant

- [x] 3.1 Eliminar de `backend/src/routes/cobros.ts` la aceptación tenant de `accessToken`, `marketplaceFeeMode`, `marketplaceFeePercentage` y `marketplaceFeeFixedAmount` como contrato editable.
- [x] 3.2 Adaptar `GET /api/cobros/mercadopago` para devolver estado de conexión + fee read-only con `editable: false`.
- [x] 3.3 Actualizar `platea/components/dashboard/cobros-content.tsx` para quitar inputs de token/comisión y mostrar botones `Conectar`, `Reconectar` y `Desconectar`.
- [x] 3.4 Actualizar `platea/components/dashboard/configuracion-content.tsx` para mostrar la comisión marketplace como información de plataforma, no editable.
- [x] 3.5 Crear/adaptar proxies Next para `oauth/start`, `oauth/callback` y `DELETE /api/cobros/mercadopago`.

## Phase 4: Ajustar checkout a seller OAuth + owner fee

- [x] 4.1 Adaptar `backend/src/routes/tenant.ts` para seguir resolviendo el cliente Mercado Pago desde la cuenta de empresa, ahora conectada por OAuth.
- [x] 4.2 Usar el fee owner-controlled resuelto por `backend/src/lib/marketplace-fee.ts` al crear la `Preference` con `marketplace_fee`.
- [x] 4.3 Mantener el gate duro de checkout antes de side effects cuando falte conexión válida o fee resoluble.
- [x] 4.4 Verificar que al desconectar la cuenta la tienda siga visible pero checkout quede bloqueado consistentemente.

## Phase 5: Verificación

- [x] 5.1 Escribir tests unitarios para resolución de fee owner-controlled y readiness con combinaciones de seller conectado/desconectado.
- [x] 5.2 Escribir tests de integración para `oauth/start`, `oauth/callback`, `disconnect` y `GET /api/cobros/mercadopago`.
- [x] 5.3 Escribir tests de integración para checkout con cuenta empresa conectada + `marketplace_fee` owner-controlled.
- [ ] 5.4 Validar manualmente el flujo end-to-end: conectar cuenta empresa, ver fee read-only, vender con fee aplicado, desconectar y bloquear checkout.

### Evidencia Phase 1

- Fuente owner-controlled implementada como config interna de backend mediante `MARKETPLACE_FEE_MODE`, `MARKETPLACE_FEE_PERCENTAGE` y `MARKETPLACE_FEE_FIXED_AMOUNT`.
- `empresa_payment_accounts` quedó limitada al vínculo de la cuenta Mercado Pago de la empresa; el fee dejó de salir de esa tabla.
- Validación ejecutada sin build: `npm test` en `backend/`.
- Resultado: `14/14` tests pasando.

### Evidencia Phase 2

- Helper nuevo: `backend/src/lib/mercadopago-oauth.ts` con `state` firmado, URL de autorización y exchange de `code`.
- Endpoints nuevos/extendidos: `POST /api/cobros/mercadopago/oauth/start`, `GET /api/cobros/mercadopago/oauth/callback`, `DELETE /api/cobros/mercadopago`.
- Persistencia OAuth ampliada en `empresa_payment_accounts` con refresh token cifrado y metadata (`oauth_token_type`, `oauth_scope`, `oauth_expires_at`, `oauth_connected_at`).
- Proxies Next agregados: `platea/app/api/cobros/mercadopago/oauth/start/route.ts`, `platea/app/api/cobros/mercadopago/oauth/callback/route.ts`, más `DELETE` en `platea/app/api/cobros/mercadopago/route.ts`.
- Validación ejecutada sin build: `npm test` en `backend/`.
- Resultado: `15/15` tests pasando con cobertura del flujo `start → callback → disconnect`.

### Evidencia Phase 3

- `backend/src/routes/cobros.ts` ahora rechaza `POST/PATCH` manuales con mensaje explícito para usar OAuth.
- `backend/src/lib/marketplace-fee.ts` expone `editable: false` en el summary owner-controlled.
- `platea/components/dashboard/cobros-content.tsx` reemplazó inputs de token/comisión por UI de conexión OAuth, refresh y desconexión.
- `platea/app/(empresa)/dashboard/cobros/page.tsx` ahora consume flash de callback OAuth y tipa el contrato read-only.
- `platea/lib/tenant.ts` suma `missing_marketplace_fee` y mensajes alineados al modelo nuevo.
- Verificación: `npm test` en `backend/` → `15/15` pasando.
- Verificación específica frontend tocado: `npx eslint "app/(empresa)/dashboard/cobros/page.tsx" "components/dashboard/cobros-content.tsx" "lib/tenant.ts"` sin errores.

### Evidencia Phase 4

- `backend/src/routes/tenant.ts` eliminó el fallback legacy `LEGACY_MARKETPLACE_FEE_RATE = 0.04` y la recomputación heredada de comisión en confirmación.
- La confirmación de pago ahora exige snapshot `sessionData.marketplaceFee`; si falta, responde conflicto estable en vez de inventar una comisión vieja.
- El checkout sigue usando cliente Mercado Pago resuelto por empresa y `marketplace_fee` owner-controlled desde el snapshot generado al iniciar checkout.
- Verificación: `npm test` en `backend/` → `15/15` pasando.
