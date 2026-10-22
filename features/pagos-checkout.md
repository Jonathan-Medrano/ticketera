# Features — Pagos / Checkout
**Rol:** fuente de verdad · **Última actualización:** 2026-06-23

## Qué es esta zona
Flujo de cobro de TICKETERA sobre **Mercado Pago marketplace** (split de fee): reserva con soft-lock de stock en `checkout_sessions`, redirect a MP, confirmación vía webhook firmado + redirect, emisión de `entradas`/`consumibles_ventas`, y cleanup de reservas expiradas. Cubre dos flows: `entradas` y `consumibles`.

## Features

| Feature | Estado | Archivos clave | Notas / deuda |
|---|---|---|---|
| Conexión MP por **OAuth** (empresa) | ✅ | `backend/src/routes/cobros.ts:70-133`, `backend/src/lib/mercadopago-oauth.ts` | start (`/mercadopago/oauth/start`) + callback. State HMAC-firmado (TTL 10 min), valida `empresaId`/`actorUserId`. Config manual MP **deshabilitada**: POST/PATCH `/mercadopago` devuelven 405 (`cobros.ts:135-145`). |
| Conexión MP OAuth (**platform owner** / super-admin) | ✅ | `backend/src/routes/platform/cobros.ts:64-189`, `mercadopago-oauth.ts` (subject `platform_owner`) | Cuenta colectora de la plataforma para `sponsor_id` del split. |
| Persistencia de credenciales MP (cifradas) | ✅ | `backend/src/lib/payment-accounts.ts:400-439` | Tokens en `empresa_payment_accounts` cifrados (ciphertext/iv/tag); `getMercadoPagoClientByEmpresaId` arma el `MercadoPagoConfig`. |
| Checkout **entradas** → reserva + soft-lock stock | ✅ | `backend/src/routes/tenant.ts:2837-3317` | Re-fetch de precio con `FOR UPDATE` (ignora `precio` del body), valida publicación del evento, decrementa `entrada_categorias.stock_disponible` y `evento_addons.stock_disponible`, crea `checkout_sessions` (`estado=reservada`, TTL 15 min). |
| Checkout **consumibles** → reserva + soft-lock stock | ✅ | `backend/src/routes/tenant.ts:2495-2834` | Mismo patrón sobre `barra_stock.stock_actual`; respeta `stock_ilimitado` (no descuenta). |
| Creación de **preference MP** (split fee) | ✅ | `tenant.ts:3282-3311` (entradas), `tenant.ts:2798-2826` (consumibles) | `marketplace_fee` + `sponsor_id` (collector de plataforma), `external_reference=sessionId`, `notification_url` al webhook, `auto_return`, `statement_descriptor`, cuotas (`mp_max_installments`, clamp 1-24). Si falla la preference → `cancelarReserva` (libera stock). |
| Stock locking serializable + retry P2034 | ✅ | `tenant.ts:77-127` (`withSerializableRetry`), `prismaDirectUrl.$transaction({ isolationLevel:'Serializable' })` | Toda reserva/confirmación usa `prismaDirectUrl` (conexión directa 5432), nunca el pooler. |
| **Webhook MP** (firmado) + idempotencia | ✅ | `tenant.ts:3370-3566`, firma `verifyMercadoPagoSignature` (`tenant.ts:145-177`), rate-limit `paymentWebhookRateLimit` (`tenant.ts:129-132`) | HMAC-SHA256 `ts/v1` con `MERCADOPAGO_WEBHOOK_SECRET`; idempotencia vía `processed_webhooks` (`processing→done/failed`, reprocesa en `failed`). Guard cross-empresa por `payment_id`+slug. `MERCADOPAGO_SKIP_WEBHOOK_SIGNATURE` solo dev; en prod = fatal 500. |
| Confirmación de pago (lógica compartida) | ✅ | `confirmarPagoLogic` `tenant.ts:851+`, `verificarPagoAprobado` `tenant.ts:~810-848` | Re-lee con `FOR UPDATE`, idempotente si `confirmada`, valida `status=approved`, `external_reference`, **monto** (±0.01) y **currency gate** (`ARS`, `tenant.ts:840-845`). Emite entradas/ventas y dispara delivery. |
| **Captura de comisión MP real + neto** (por transacción) | ✅ | webhook `tenant.ts:809-826` (extrae `fee_details[mercadopago_fee]`), persiste `mp_fee_amount`/`neto_empresa_amount` en `entradas` (`tenant.ts:1136-1163`) y `consumibles_ventas` (`tenant.ts:1011-1014`) | La comisión de MP es REAL (del pago), no estimada. Caveat: filas confirmadas antes de capturar `mp_fee_amount` quedan en NULL. |
| **Panel de comisiones reales** (dashboard empresa) | ✅ | `backend/src/routes/comisiones.ts` (`GET /api/comisiones`, gate `ver_recaudacion`); `platea/app/(empresa)/dashboard/comisiones/page.tsx`, `platea/components/dashboard/comisiones-content.tsx`; BFF `platea/app/api/comisiones/route.ts` | Agrega por período/flujo/evento: comisión MP real (`mp_fee_amount`) + comisión TICKETERA (`comision`/`owner_fee_amount`) + neto (`neto_empresa_amount`). Filtra por fecha en TZ AR (`AT TIME ZONE` AR). Filas legacy sin `mp_fee` → reportadas en `sin_datos`, excluidas de totales. Refuerza el claim "tu plata en tu MP". |
| Confirmación por **redirect** (back_urls) | ✅ | `tenant.ts:3338-3368` (`/pago/confirmar-redirect`), token `?ct=` (`confirmationToken`) | Path de fallback además del webhook; valida `confirmationToken` de la sesión. |
| Confirmación manual desde frontend | ✅ | `tenant.ts:3320-3335` (`POST /pago/confirmar`) | Requiere comprador autenticado dueño de la sesión. |
| **Cleanup** de reservas expiradas + restauración de stock | ✅ | `backend/src/services/checkoutCleanup.ts`, job `backend/src/jobs/expiredCheckoutCleanupJob.ts` (cada 30 s) | Advisory lock `8823`, `FOR UPDATE SKIP LOCKED`, restaura stock de entradas/addons/consumibles (respeta `stock_ilimitado`), promueve waitlists post-commit. |
| **Split de fee** marketplace (absorbed / passed_to_buyer / split) | ✅ | `tenant.ts:3166-3195` (`fee_billing_mode`, `fee_split_buyer_pct`), `backend/src/lib/marketplace-fee.ts` (`resolveMarketplaceFee`) | Fee sobre subtotal **neto** (post-descuento). El precio del item se infla por la fracción del comprador; `marketplace_fee` absoluto va por `application_fee` de MP. |
| **Profit-sharing** de plataforma | ✅ | `backend/src/lib/platform-profit-sharing.ts`, advisory lock `9002` | Distribuye el fee entre platform admins (jerarquía padre/hijo) al confirmar. |
| Códigos de descuento en checkout | ✅ | `tenant.ts:3140-3164` (aplicación), `tenant.ts:3574+` (`/validar-codigo-descuento` solo preview), `tenant.ts:1327-1334` (registro de uso) | Enforcement real con `FOR UPDATE` + incremento dentro de la tx; preview no lockea. |
| Delivery post-compra (email / WhatsApp QR) | ✅ | `tenant.ts:325-437` (dispatch + `delivery_dispatch_attempts`), `buildEntradasEmailHtml`/`buildConsumiblesEmailHtml` | Respeta `delivery_preference` (`email`/`whatsapp`/`both`); QR vía api.qrserver.com. |
| **Reconciliación** (pagos aprobados fuera de ventana) | ⚠️ | `backend/src/routes/reconciliacion.ts` | `approved_after_expiry`, `empresa_suspendida_al_confirmar`, `invalid_state` quedan `needs_review` (`tenant.ts:948-976`); panel para reembolsar o emitir manual. Deuda: requiere intervención humana (no auto-resuelve). |
| **Reembolsos** (workflow aprobación) | ✅ | `backend/src/routes/reembolsos.ts` (create/approve/execute/reject), `backend/src/lib/mp-refund.ts`, `backend/src/lib/refund-manual.ts` | Refund vía API MP con idempotency key; export workbook. |
| BFF proxies (frontend) | ✅ | `platea/app/api/tenant/[slug]/{checkout,consumibles/checkout,pago/{confirmar,confirmar-redirect,webhook}}/route.ts`, `platea/app/api/{cobros,platform/cobros}/mercadopago/**` | Agregan `x-internal-secret`/`x-user` y proxean a Express. |

## Lo que NO hay (anti-alucinación)
- **No** hay configuración manual de credenciales MP (access token a mano): POST/PATCH `/mercadopago` responden 405. Solo OAuth.
- **No** hay multi-currency: las preferences hardcodean `currency_id: 'ARS'` y `confirmarPagoLogic` rechaza cualquier moneda ≠ ARS. App AR-only.
- **No** hay otros proveedores de pago (Stripe, etc.). Solo Mercado Pago.
- ✅ **Refresh automático del token OAuth de MP** (resuelto 2026-06-24): `getMercadoPagoClientByEmpresaId` hace pre-emptive refresh (margen 7 días) vía `refreshMercadoPagoAccessToken` y persiste el token renovado cifrado. Revocación → marca `blocked`/`credentials_invalid`; transitorio → reintenta luego. Test `mercadopago-oauth-refresh.test.ts`.
- **No** hay reconciliación automática de los casos `needs_review`: requieren acción manual desde el panel.
- **No** se confía en el `precio` que manda el browser — siempre se re-fetchea de DB con `FOR UPDATE`.

## Deuda conocida resuelta
- **Bug histórico `COUNT(*) ... FOR UPDATE` (0A000)**: ✅ **resuelto**. La reserva ahora envuelve el lock en subquery: `SELECT COUNT(*) FROM (SELECT 1 ... FOR UPDATE) AS locked` (`tenant.ts:2956-2964` entradas, `tenant.ts:2588-2591` consumibles). Postgres ya no rechaza el agregado.

## Ver también
- `../FEATURES.md`
- `entradas.md`
- `consumibles-barra.md`
- `super-admin.md`
- `../playbook-checkout.md`
- `../playbook-pagos.md`
- `../queries-criticas.txt`
