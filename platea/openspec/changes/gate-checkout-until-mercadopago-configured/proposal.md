# Proposal: Gate Checkout Until Mercado Pago Configured

## Intent

Hoy un sitio puede quedar visible aunque la empresa no tenga una cuenta Mercado Pago lista ni una comisión marketplace aplicable, dejando un checkout que intenta vender sin modelo de cobro válido para tenant y plataforma. Este cambio mantiene el sitio visible pero no vendible hasta que la empresa tenga credenciales propias listas y el checkout pueda cobrar con application fee desde el inicio.

## Scope

### In Scope
- Checkout Mercado Pago por empresa, sin token global compartido, usando credenciales del tenant.
- Comisión de plataforma por venta mediante modelo marketplace fee / application fee desde el primer checkout válido.
- Bloqueo duro en backend para crear checkout o iniciar pagos si la empresa no está `ready_to_sell`.
- Señales de estado para frontend público y dashboard (`missing_provider`, `pending_validation`, `ready_to_sell`, `blocked`).
- Módulo de dashboard para ver estado, configurar credenciales y reflejar readiness comercial.

### Out of Scope
- Soporte para providers adicionales a Mercado Pago.
- Onboarding KYC completo, conciliación, split avanzado o payouts automáticos.
- Ocultar el sitio/subdominio o pausar navegación pública.

## Capabilities

### New Capabilities
- `payment-account-configuration`: alta, edición y validación del medio de cobro por empresa con política de comisión separada.
- `sales-readiness-status`: estado operativo reutilizable por backend y frontend.
- `checkout-gating`: bloqueo de checkout/pago y aplicación de comisión cuando la empresa puede cobrar.

### Modified Capabilities
- None

## Approach

Persistir por `empresa_id` una cuenta Mercado Pago con credenciales, estado de validación y política de comisión desacoplada del secreto. Centralizar en backend `getSalesReadiness/companyPaymentConfig` para decidir `canSell`, resolver el cliente MP del tenant y crear preferencias/pagos con application fee antes de cualquier reserva o side effect. Exponer el mismo contrato de readiness a sitio público y dashboard para deshabilitar compra, explicar el motivo y habilitar configuración.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/tenant.ts` | Modified | Gate de checkout y creación de pagos con credenciales por empresa |
| `backend/src/lib/payment-accounts.ts` | New/Modified | Resolución de cuenta MP por tenant y comisión marketplace |
| `backend/src/routes/configuracion.ts` | Modified | Exponer estado resumido y readiness comercial |
| `backend/src/routes/index.ts` | Modified | Registrar módulo/rutas de cobros |
| `platea/app/api/tenant/[slug]/checkout/route.ts` | Modified | Propagar bloqueos, razones y contratos de venta no habilitada |
| `platea/components/tenant/checkout-content.tsx` | Modified | Deshabilitar compra y mostrar estado |
| `platea/components/dashboard/*` | New/Modified | Configuración de cobro por empresa y feedback de readiness |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Bloqueo parcial solo en UI | Med | Backend como fuente de verdad |
| Credenciales inválidas marcadas como listas | Med | Validación activa contra Mercado Pago |
| Impacto en flujo actual de checkout | Med | Gate antes de reserva/Preference |

## Rollback Plan

Desactivar el gate nuevo, volver al flujo actual de checkout y mantener la configuración almacenada sin usar hasta corregir validación o contratos.

## Dependencies

- Credenciales Mercado Pago por empresa y validación activa del tenant antes de vender.
- Soporte de Mercado Pago para application fee / marketplace fee en el flujo elegido.
- Storage seguro para secretos y configuración de comisión por tenant.

## Suggested Phases

1. Modelo backend de cuenta MP por empresa + storage seguro + política de comisión.
2. Validación/readiness compartido + señales para sitio visible pero no vendible.
3. Checkout/pago con credenciales por empresa y application fee aplicada.
4. Dashboard de configuración y feedback operativo.

## Success Criteria

- [ ] Una empresa sin cuenta válida ve su sitio público pero no puede iniciar checkout ni pago directo.
- [ ] Backend rechaza venta/checkout con razón explícita antes de reservar stock o crear artifacts de pago.
- [ ] Una empresa `ready_to_sell` opera checkout con sus propias credenciales Mercado Pago, sin token global compartido.
- [ ] Cada venta válida incluye la comisión de plataforma vía marketplace fee/application fee.
