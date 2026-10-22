# Design: Gate Checkout Until Mercado Pago Configured

## Technical Approach

Agregar una capa explícita de `payment account` por empresa, persistida en MySQL, con secreto cifrado, configuración de comisión de marketplace y validación contra Mercado Pago antes de habilitar venta. El backend seguirá siendo la fuente de verdad: un helper central `getSalesReadiness(empresaId)` derivará `status`, `reason` y `canSell`, y una policy `resolveMarketplaceFee(empresaId, order)` calculará la comisión exacta a persistir y enviar a MP. El rollout será incremental: primero almacenar/configurar, luego exponer señales, y recién después activar el gate duro en checkout.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Nueva tabla `empresa_payment_accounts` en vez de columnas en `empresas` | Columnas sueltas en `empresas`; JSON blob | Permite provider por empresa, historial mínimo de validación y futura extensión a otros providers sin contaminar `empresas`. |
| Guardar `access_token` cifrado reversible (AES-256-GCM con key de entorno) | Texto plano; hash; secret manager externo | Texto plano es inseguro; hash no sirve porque el backend debe llamar a MP; vault externo hoy agrega dependencia operativa no presente en Platea. |
| Helper reusable en `backend/src/lib/sales-readiness.ts` + `payment-accounts.ts` | Duplicar lógica en rutas; crear capa service completa | El código actual concentra lógica en routes y helpers en `lib/`; esto minimiza cambio estructural y centraliza la policy. |
| Validación activa con request autenticado a Mercado Pago (`GET /v1/payment_methods`) | Solo validar formato del token; validar recién al crear preference | El formato no prueba cobrabilidad. Validar antes evita falsos `ready_to_sell` y reduce fallas en checkout. |
| Comisión marketplace configurable por empresa con soporte `percentage`, `fixed`, `hybrid`, pero recomendación inicial `percentage` | Solo monto fijo; hardcode global; combinar libre sin policy | Porcentaje escala con el ticket y evita subcobro en órdenes grandes. El schema queda listo para fijo/híbrido, pero la UI inicial debe habilitar solo porcentaje para reducir complejidad operativa. |
| Gate duro solo antes de reservar stock y crear preference | Gate solo UI; gate también en confirmación post-pago | UI sola no alcanza. Bloquear confirmación post-pago podría dejar cobros aprobados sin conciliación local; por eso el gate se aplica al inicio de venta, no al cierre de una operación ya cobrada. |
| Calcular comisión una sola vez al iniciar checkout y persistir snapshot | Recalcular al confirmar; recalcular en reporting | Recalcular después genera diferencias por redondeo o cambios de config. El mismo valor snapshot debe usarse en `marketplace_fee/application_fee` y en conciliación local. |

## Data Flow

Dashboard guarda credenciales + policy de comisión → backend cifra secreto → persistencia `pending_validation` → validación MP → `resolveMarketplaceFee()` calcula snapshot en checkout → preference MP con `marketplace_fee` → frontend consume estado.

`/dashboard/cobros` → `POST/PATCH /api/cobros/mercadopago` → `empresa_payment_accounts`
`empresa_payment_accounts` → `getSalesReadiness(empresaId)` →
1. `POST /tenant/:slug/checkout` (gate)
2. `GET /tenant/:slug` (señal pública)
3. `GET /configuracion` y `GET /api/cobros/mercadopago` (dashboard)

## File Changes

| File | Action | Description |
|---|---|---|
| `actualizar db.sql` | Modify | Crear tabla `empresa_payment_accounts` y campos de policy/snapshot de comisión. |
| `backend/src/lib/payment-accounts.ts` | Create | Cifrado/descifrado, persistencia y validación de credenciales MP. |
| `backend/src/lib/sales-readiness.ts` | Create | Contrato central `getSalesReadiness` / `assertCanSell`. |
| `backend/src/lib/marketplace-fees.ts` | Create | Policy de comisión, rounding y snapshot estable por checkout. |
| `backend/src/routes/cobros.ts` | Create | Alta/edición/read-model redactado de cuenta Mercado Pago. |
| `backend/src/routes/configuracion.ts` | Modify | Incluir readiness resumido para dashboard. |
| `backend/src/routes/tenant.ts` | Modify | Agregar readiness, calcular snapshot de fee y reemplazar el `COMISION = 0.04` global. |
| `backend/src/routes/index.ts` | Modify | Registrar router `/cobros`. |
| `platea/lib/tenant.ts` | Modify | Tipos `salesReadiness` públicos. |
| `platea/app/api/cobros/mercadopago/route.ts` | Create | Proxy dashboard hacia backend. |
| `platea/app/(empresa)/dashboard/cobros/page.tsx` | Create | Pantalla de configuración de cobro. |
| `platea/components/dashboard/sidebar.tsx` | Modify | Acceso al módulo Cobros. |
| `platea/components/dashboard/configuracion-content.tsx` | Modify | Mostrar badge/resumen de readiness. |
| `platea/components/tenant/tenant-home.tsx` | Modify | Deshabilitar CTA rápidos y comunicar `can_sell=false`. |
| `platea/components/tenant/evento-detalle.tsx` | Modify | Bloquear `Ir al checkout` y compra rápida cuando no pueda vender. |
| `platea/components/tenant/checkout-content.tsx` | Modify | Bloquear submit y mostrar error estable devuelto por backend. |

## Interfaces / Contracts

```ts
type SalesReadinessStatus = 'missing_provider' | 'pending_validation' | 'ready_to_sell' | 'blocked'
type SalesReadinessReason =
  | 'missing_provider'
  | 'credentials_invalid'
  | 'provider_unreachable'
  | 'provider_blocked'
  | 'manual_block'
  | 'validation_pending'
```

Tabla propuesta `empresa_payment_accounts`:
- `id`, `empresa_id`, `provider('mercadopago')`, `status`, `reason`
- `credential_ciphertext`, `credential_iv`, `credential_tag`, `credential_last4`
- `marketplace_fee_mode('percentage','fixed','hybrid')`, `marketplace_fee_percentage`, `marketplace_fee_fixed_amount`
- `provider_account_label` nullable
- `validated_at`, `last_validation_error`, `blocked_at`, `created_at`, `updated_at`
- `UNIQUE (empresa_id, provider)`

Snapshot transaccional recomendado:
- `checkout_sessions.marketplace_fee_amount`, `checkout_sessions.marketplace_fee_snapshot` (JSON con mode, percentage, fixed, currency, subtotal)
- Reusar `entradas.comision` como comisión de plataforma por entrada SOLO si el negocio confirma que ese campo hoy representa marketplace fee; si no, crear `entradas.marketplace_fee` para no mezclar semánticas.

Regla de cálculo:
- Recomendación inicial: `percentage` sobre subtotal bruto de entradas, redondeado a 2 decimales al nivel de checkout.
- `fixed`: monto fijo por checkout, útil para onboarding futuro pero NO recomendado como default.
- `hybrid`: porcentaje + fijo, permitido en schema pero no expuesto en Fase 1.

Endpoints afectados:
- `GET /api/configuracion` → agrega `sales_readiness`
- `GET /api/cobros/mercadopago` → config redactada + readiness + policy de comisión visible
- `POST|PATCH /api/cobros/mercadopago` → guarda secreto + comisión, deja `pending_validation`, valida y devuelve estado final
- `GET /api/tenant/:slug` → agrega `sales_readiness` pública (`status`, `reason`, `can_sell`)
- `POST /api/tenant/:slug/checkout` → `409` con `{ code:'sales_not_ready', status, reason, error }`

Señales frontend:
- Tenant layout/provider consume `sales_readiness` una vez desde `GET /tenant/:slug` y la comparte a home, detalle y checkout.
- Dashboard muestra badge + CTA accionable (`Configurar cobro`, `Validando`, `Bloqueado`) desde `GET /configuracion` y detalle redactado desde `GET /cobros/mercadopago`.
- El dashboard debe mostrar la policy activa (`12%`, `$X fijo`, etc.), pero NO el fee calculado por operación; eso sale de reportes/snapshots, no de configuración.

Aplicación en Mercado Pago:
- Checkout Pro: crear `Preference` con cliente MP de la empresa y `marketplace_fee = checkout.marketplace_fee_amount`.
- Payments API futuro: crear `Payment` con cliente MP de la empresa y `application_fee = checkout.marketplace_fee_amount`.
- Impacto en cliente MP: el token configurado por empresa sigue siendo el del seller; no cambia el factory del cliente, cambia el payload de creación de preference/payment.

## Validation & Error Handling

- Credencial inválida MP → persistir `blocked/credentials_invalid`, nunca exponer token ni mensaje raw de MP.
- Timeout o 5xx de MP → persistir `pending_validation/provider_unreachable`; el dashboard puede reintentar sin reingresar secreto.
- `POST /tenant/:slug/checkout` con `canSell=false` → cortar antes de `beginTransaction`, sin reservar stock ni crear `checkout_session`.
- Si la policy de comisión es inválida (porcentaje < 0 o > 100, fijo < 0, híbrida vacía) → `400` en `/api/cobros/mercadopago` y no se persiste readiness nueva.
- Si el snapshot local y la fee enviada a MP divergen, la operación debe fallar antes de crear la preference; NUNCA recalcular silenciosamente.
- Fallback legacy: mientras Fase 1-2 esté activa, si no hay registro nuevo se responde `missing_provider` en lecturas, pero el gate duro sigue apagado.

Consistencia contable:
- Calcular fee una sola vez por checkout y persistir snapshot inmutable.
- En confirmación de pago, distribuir ese total a nivel entrada con prorrateo determinístico solo para reporting, asegurando que la suma exacta coincida con `checkout_sessions.marketplace_fee_amount`.
- Separar conceptualmente `marketplace_fee` de otras comisiones (ej. revendedores). No reutilizar porcentajes default de revendedores para cobro plataforma.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Cálculo de readiness, policy de fee, prioridad de `blocked`, cifrado/descifrado | Tests sobre helpers en `lib/` con fixtures de DB rows. |
| Integration | `POST /cobros/mercadopago`, `GET /configuracion`, `POST /tenant/:slug/checkout` | Mock de validación MP y assertions sobre payload, `marketplace_fee` y 409 sin reservar stock. |
| E2E | Dashboard configura cuenta; tenant bloqueado/desbloqueado | Flujo manual asistido inicialmente; automatizar después del gate estable. |

## Migration / Rollout

Fase 1: schema + router `/cobros` + storage cifrado + policy de comisión (UI inicial solo porcentaje), sin gate activo.  
Fase 2: helper de readiness + `resolveMarketplaceFee` + señales en `/configuracion` y `/tenant/:slug`; UI pública deshabilitada pero checkout backend aún tolerante con flag temporal default-off.  
Fase 3: activar `assertCanSell` en `POST /tenant/:slug/checkout`, persistir snapshot de fee y enviar `marketplace_fee` a Checkout Pro; no tocar confirmación de pago existente salvo snapshot contable.  
Fase 4: limpiar uso global de `process.env.MP_ACCESS_TOKEN` para `Preference` y `Payment`, reemplazándolo por cliente MP por empresa y dejando listo `application_fee` para Payments API.

No requiere migración de datos previa: empresas sin registro nuevo quedan en `missing_provider`, preservando visibilidad pública y evitando romper navegación.

## Open Questions

- [ ] Confirmar nombre definitivo de la env key maestra de cifrado (`PAYMENT_ACCOUNTS_ENCRYPTION_KEY`).
