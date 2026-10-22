# Proposal: Owner-Controlled Mercado Pago OAuth

## Intent

Hoy la empresa configura manualmente el access token de Mercado Pago y además puede editar la comisión marketplace desde su dashboard. Ese modelo contradice el negocio real: la empresa solo debe autorizar su cuenta para cobrar, mientras que la comisión de la plataforma debe ser definida exclusivamente por el dueño de Platea. Este cambio reemplaza la carga manual de credenciales por un flujo OAuth de Mercado Pago y separa la política de comisión para que quede bajo control del owner de la plataforma.

## Scope

### In Scope
- Flujo OAuth iniciado desde el dashboard empresa con botón `Conectar Mercado Pago`.
- Persistencia de credenciales OAuth de la cuenta de la empresa y su estado de conexión/validación.
- Reemplazo de la carga manual de `accessToken` en empresa por conexión OAuth, reconexión y desconexión.
- Comisión marketplace controlada por la plataforma, independiente de la cuenta conectada por la empresa.
- Aplicación del fee owner-controlled en Checkout Pro mediante `marketplace_fee` manteniendo como cuenta cobradora la de la empresa.
- Contrato dashboard/publico/backend consistente para mostrar estado de conexión y readiness comercial sin permitir edición del fee desde empresa.

### Out of Scope
- Soporte para múltiples providers de cobro además de Mercado Pago.
- Portal completo de superadmin si hoy no existe; la primera fase puede resolver la comisión owner-controlled desde config interna o tabla propia no expuesta a tenant.
- Split avanzado, payouts automáticos externos o conciliación financiera completa del fee del owner.
- Cambio de provider de checkout o migración a Payments API si Checkout Pro ya resuelve el caso actual.

## Capabilities

### New Capabilities
- `mercadopago-oauth-connection`: la empresa autoriza y conecta su cuenta Mercado Pago mediante OAuth en vez de pegar tokens manualmente.
- `owner-controlled-marketplace-fee`: la plataforma define una comisión estable por venta sin permitir que la empresa la edite.
- `payment-connection-readiness`: dashboard y checkout derivan el estado comercial desde la conexión OAuth y la configuración de fee de plataforma.

### Modified Capabilities
- `payment-account-configuration`: deja de aceptar access tokens manuales y deja de permitir edición de comisión desde la empresa.
- `checkout-gating`: sigue bloqueando ventas si la empresa no está lista, pero pasa a depender de conexión OAuth válida + fee de plataforma resoluble.
- `sales-readiness-status`: mantiene los estados estables, pero la causa operativa deja de depender de una comisión enviada por la empresa.

## Approach

Crear un nuevo flujo de backend para iniciar OAuth, resolver el callback, intercambiar `code` por credenciales de Mercado Pago y guardar el vínculo de la cuenta cobradora por `empresa_id`. En paralelo, mover la comisión marketplace fuera de `empresa_payment_accounts` hacia una fuente de configuración controlada por la plataforma. El dashboard empresa mostrará solo el estado de conexión y una comisión informativa read-only; el checkout seguirá cobrando con la cuenta conectada de la empresa y aplicará el fee definido por el owner.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/cobros.ts` | Modified | Reemplazar save manual por endpoints de OAuth/connect/disconnect y lectura read-only del fee |
| `backend/src/lib/payment-accounts.ts` | Modified | Persistir credenciales OAuth y metadata de conexión sin comisión editable por tenant |
| `backend/src/lib/marketplace-fee.ts` | Modified | Resolver comisión desde configuración owner-controlled, no desde la cuenta de empresa |
| `backend/src/routes/tenant.ts` | Modified | Crear preferencias MP con cuenta conectada por OAuth + fee controlado por owner |
| `backend/src/lib/sales-readiness.ts` | Modified | Derivar readiness desde cuenta conectada válida y fee resoluble |
| `platea/components/dashboard/cobros-content.tsx` | Modified | Reemplazar inputs de token/comisión por botón OAuth y estado de conexión |
| `platea/app/api/cobros/mercadopago/*` | Modified/New | Proxy para start/callback/disconnect del flujo OAuth |
| `platea/components/dashboard/configuracion-content.tsx` | Modified | Mostrar fee read-only y CTA de conexión |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mezclar fee de owner con settings de empresa otra vez | Med | Separar storage, contratos y permisos desde proposal/design |
| Implementar OAuth sin contemplar refresh/revocación | Med | Diseñar persistencia de token lifecycle antes de apply |
| Mostrar UI de fee editable por error en tenant | Med | Eliminar inputs y exponer solo resumen read-only desde backend |
| Dependencia de habilitación Marketplace/OAuth de MP | Med | Documentar prerequisitos y fallback operacional antes de rollout |

## Rollback Plan

Mantener el gate comercial existente, desactivar el inicio OAuth en UI y volver temporalmente a la configuración actual mientras se preservan los registros nuevos de conexión para no perder autorización de cuentas.

## Dependencies

- Aplicación Mercado Pago con OAuth habilitado y redirect URIs configuradas.
- Soporte operativo de Mercado Pago para cobrar con cuenta del seller y fee de plataforma vía `marketplace_fee`.
- Fuente de configuración owner-controlled para el porcentaje de comisión (tabla propia o config interna de backend).

## Suggested Phases

1. Separar comisión de plataforma del modelo `empresa_payment_accounts` y dejarla owner-controlled.
2. Implementar endpoints/backend de OAuth (`start`, `callback`, `disconnect`) y persistencia de conexión.
3. Adaptar dashboard empresa a botón `Conectar Mercado Pago` + fee read-only.
4. Ajustar checkout/readiness para depender del seller conectado por OAuth y del fee resuelto desde plataforma.

## Success Criteria

- [ ] La empresa puede conectar su cuenta Mercado Pago desde un botón OAuth sin pegar tokens manuales.
- [ ] La empresa no puede editar la comisión marketplace desde ninguna pantalla tenant.
- [ ] La plataforma puede aplicar un fee estable por venta (ej. 4%) sin cambiar la cuenta cobradora de la empresa.
- [ ] El checkout cobra con la cuenta conectada de la empresa y envía el fee del owner mediante `marketplace_fee`.
- [ ] Si la empresa no conectó correctamente Mercado Pago, el sistema sigue visible pero no vende.
