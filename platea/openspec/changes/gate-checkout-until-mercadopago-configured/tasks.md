# Tasks: Gate Checkout Until Mercado Pago Configured

## Phase 1: Schema, comisión y storage seguro

- [x] 1.1 Actualizar `actualizar db.sql` para crear `empresa_payment_accounts` con `UNIQUE (empresa_id, provider)`, estados de validación, cifrado reversible y campos de comisión marketplace alineados al design (`marketplace_fee_mode`, `marketplace_fee_percentage`, `marketplace_fee_fixed_amount`).
- [x] 1.2 Crear `backend/src/lib/payment-accounts.ts` con contratos row/model, lectura/escritura por `empresa_id` y máscara de `credential_last4` para read-models.
- [x] 1.3 Implementar en `backend/src/lib/payment-accounts.ts` cifrado reversible AES-256-GCM usando `PAYMENT_ACCOUNTS_ENCRYPTION_KEY`; fallar explícito si la env no existe o es inválida.
- [x] 1.4 Integrar validación Mercado Pago en `backend/src/lib/payment-accounts.ts` contra `GET /v1/payment_methods`, mapeando resultados a razones estables sin filtrar errores raw.
- [x] 1.5 Agregar en `backend/src/lib/payment-accounts.ts` validación de configuración de comisión (modos `percentage`, `fixed`, `hybrid`; rangos permitidos; híbrida no vacía) antes de persistir.

## Phase 2: Readiness, comisión y API backend de cobros

- [x] 2.1 Crear `backend/src/lib/sales-readiness.ts` con `getSalesReadiness(empresaId)` y `assertCanSell(empresaId)`, priorizando `blocked` sobre cualquier otro estado.
- [x] 2.2 Crear `backend/src/lib/marketplace-fee.ts` con cálculo determinístico de comisión a partir del total y la configuración por empresa, devolviendo monto final y metadata reusable.
- [x] 2.3 Crear `backend/src/routes/cobros.ts` con `GET /api/cobros/mercadopago` que devuelva configuración redactada, comisión configurada y `sales_readiness`.
- [x] 2.4 Agregar en `backend/src/routes/cobros.ts` `POST/PATCH /api/cobros/mercadopago`: guardar secreto cifrado, persistir comisión, marcar `pending_validation`, validar y devolver estado final.
- [x] 2.5 Extender `backend/src/routes/configuracion.ts` y `backend/src/routes/index.ts` para incluir `sales_readiness` + resumen de comisión y registrar `/cobros`.

## Phase 3: Señales públicas, cálculo y gate duro de checkout

- [x] 3.1 Extender `backend/src/routes/tenant.ts` para sumar `sales_readiness` pública (`status`, `reason`, `can_sell`) en `GET /api/tenant/:slug` sin exponer credenciales.
- [x] 3.2 Reemplazar en `backend/src/routes/tenant.ts` el uso global de `process.env.MP_ACCESS_TOKEN` por cliente Mercado Pago por empresa derivado desde `payment-accounts.ts`.
- [x] 3.3 Integrar `backend/src/lib/marketplace-fee.ts` en `backend/src/routes/tenant.ts` para calcular comisión por checkout y adjuntar metadata estable a la sesión/compra.
- [x] 3.4 Enviar `marketplace_fee`/`application_fee` al crear `Preference` o pago en `backend/src/routes/tenant.ts`, usando el nombre de campo correcto según el SDK ya usado por Platea.
- [x] 3.5 Aplicar `assertCanSell` en `POST /api/tenant/:slug/checkout` dentro de `backend/src/routes/tenant.ts` antes de `beginTransaction`, reserva de stock o creación de `Preference`; responder `409` con `code: 'sales_not_ready'`.
- [x] 3.6 Propagar en `platea/app/api/tenant/[slug]/checkout/route.ts` el contrato de error estable del backend sin reinterpretar códigos ni mensajes.

## Phase 4: Dashboard y tenant frontend

- [x] 4.1 Extender `platea/lib/tenant.ts` y `platea/components/tenant/tenant-provider.tsx` para tipar/distribuir `sales_readiness` en toda la experiencia pública.
- [x] 4.2 Adaptar `platea/components/tenant/tenant-home.tsx`, `platea/components/tenant/evento-detalle.tsx` y `platea/components/tenant/checkout-content.tsx` para deshabilitar CTA/submit, mostrar motivo estable y tolerar rechazo directo del API.
- [x] 4.3 Crear `platea/app/api/cobros/mercadopago/route.ts` como proxy al backend y `platea/app/(empresa)/dashboard/cobros/page.tsx` como entrypoint del módulo con formulario de comisión.
- [x] 4.4 Actualizar `platea/components/dashboard/sidebar.tsx` y `platea/components/dashboard/configuracion-content.tsx` para agregar acceso a Cobros y badge/resumen accionable desde `sales_readiness` y comisión activa.

## Phase 5: Validación final

- [x] 5.1 Escribir tests unitarios para `backend/src/lib/payment-accounts.ts` y `backend/src/lib/sales-readiness.ts`: cifrado/descifrado, fallback `missing_provider`, prioridad `blocked` y mapeo `credentials_invalid`/`provider_unreachable`.
- [x] 5.2 Escribir tests unitarios para `backend/src/lib/marketplace-fee.ts`: porcentaje, monto fijo, redondeo, fee deshabilitada y límites inválidos.
- [x] 5.3 Escribir tests de integración para `backend/src/routes/cobros.ts`, `backend/src/routes/configuracion.ts` y `backend/src/routes/tenant.ts` cubriendo create/replace config, `pending_validation`, `ready_to_sell`, `409 sales_not_ready` y envío correcto de `marketplace_fee`/`application_fee`.
- [x] 5.4 Ejecutar validación manual end-to-end sobre dashboard + tenant público: empresa bloqueada no vende, cuenta válida habilita checkout y la comisión configurada impacta el request enviado a Mercado Pago.

### Evidencia Fase 5

- Archivo agregado: `backend/src/mercadopago-gating.test.ts`
- Validación ejecutada sin build: `npm test` en `backend/`
- Resultado: `14/14` tests pasando con cobertura específica de cifrado/descifrado, readiness (`missing_provider`, `blocked`, `credentials_invalid`, `provider_unreachable`), cálculo de `marketplace_fee`, `pending_validation`, `ready_to_sell`, `409 sales_not_ready` y payload enviado a Mercado Pago.
