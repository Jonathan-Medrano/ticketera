# Design: Owner-Controlled Mercado Pago OAuth

## Technical Approach

Separar definitivamente dos responsabilidades que hoy están acopladas incorrectamente: la conexión de la cuenta cobradora de la empresa y la política de comisión de la plataforma. La empresa conectará su cuenta Mercado Pago mediante OAuth, y el backend persistirá esa autorización por `empresa_id` junto con su estado de validación. En paralelo, la comisión marketplace se resolverá desde una fuente owner-controlled fuera de `empresa_payment_accounts`. El checkout seguirá usando la cuenta conectada de la empresa para crear la `Preference`, pero el valor de `marketplace_fee` saldrá siempre de la policy del owner.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Reemplazar token manual por OAuth company-scoped | Mantener access token pegado manualmente | OAuth reduce error operativo, evita copiar secretos y alinea el producto con un onboarding serio de sellers. |
| Separar fee del owner de `empresa_payment_accounts` | Seguir guardando fee junto a las credenciales de la empresa | La comisión es una regla de negocio de plataforma, no un atributo de la cuenta del seller. Mezclarlas rompe permisos y modelo mental. |
| Mantener dashboard empresa con fee read-only | Permitir edición condicionada por permisos tenant | Ningún permiso tenant debe tocar revenue de la plataforma. Read-only elimina ambigüedad. |
| Resolver fee desde config interna o tabla owner-controlled en Fase 1 | Esperar a tener panel superadmin completo | La ausencia de UI admin no justifica dejar mal el dominio. Primero corregimos ownership, después agregamos UI. |
| Conservar readiness compartido backend/public/dashboard | Hacer chequeos distintos por cliente | Una sola fuente de verdad evita bypass, inconsistencias y UX contradictoria. |
| Aplicar `marketplace_fee` en Checkout Pro con cuenta OAuth de la empresa | Cambiar ahora a Payments API | Checkout Pro ya existe en el producto; cambiar también el provider flow agranda el riesgo sin necesidad inmediata. |

## Data Flow

Dashboard empresa → `POST /api/cobros/mercadopago/oauth/start` → redirección OAuth Mercado Pago → `GET /api/cobros/mercadopago/oauth/callback` → intercambio de `code` por credenciales → persistencia de cuenta conectada por `empresa_id` → validación/readiness.

Owner fee source → `resolveMarketplaceFee(empresaId, subtotal)` → checkout backend → `Preference.create({ marketplace_fee })` con cliente Mercado Pago de la empresa.

Readiness compartido:
1. Dashboard empresa: CTA `Conectar`, `Reconectar`, `Desconectar`
2. Dashboard/configuración: fee read-only + estado comercial
3. Tenant público: visible pero no vendible si no está ready
4. Backend checkout: gate duro antes de side effects

## File Changes

| File | Action | Description |
|---|---|---|
| `backend/src/lib/payment-accounts.ts` | Modify | Adaptar storage para credenciales OAuth, metadata de seller y lifecycle de conexión; eliminar ownership tenant del fee. |
| `backend/src/lib/marketplace-fee.ts` | Modify | Resolver fee desde fuente owner-controlled en vez de leer `empresa_payment_accounts`. |
| `backend/src/lib/sales-readiness.ts` | Modify | Considerar conexión OAuth válida + fee resoluble como prerequisitos de `ready_to_sell`. |
| `backend/src/routes/cobros.ts` | Modify | Reemplazar POST/PATCH manual por endpoints `oauth/start`, `oauth/callback`, `disconnect` y read model dashboard read-only. |
| `backend/src/routes/tenant.ts` | Modify | Seguir creando Checkout Pro con cliente MP de empresa y `marketplace_fee` owner-controlled. |
| `backend/src/routes/configuracion.ts` | Modify | Exponer fee read-only y readiness coherente al dashboard de empresa. |
| `platea/app/api/cobros/mercadopago/route.ts` | Modify | Adaptar proxy a nuevos contratos GET/DELETE y quitar flujos de save manual. |
| `platea/app/api/cobros/mercadopago/oauth/start/route.ts` | Create | Proxy para iniciar OAuth desde frontend. |
| `platea/app/api/cobros/mercadopago/oauth/callback/route.ts` | Create | Proxy/handler de retorno OAuth según arquitectura actual. |
| `platea/components/dashboard/cobros-content.tsx` | Modify | Eliminar inputs de access token/comisión y reemplazar por botones y estado de conexión. |
| `platea/components/dashboard/configuracion-content.tsx` | Modify | Mostrar comisión activa como informativa, nunca editable por tenant. |
| `actualizar db.sql` | Modify | Ajustar schema de cuenta MP y agregar fuente owner-controlled de fee si aún no existe. |

## Interfaces / Contracts

### Dashboard company payment read model

```ts
type CompanyMercadoPagoConnection = {
  provider: 'mercadopago'
  status: 'missing_provider' | 'pending_validation' | 'ready_to_sell' | 'blocked'
  reason: string | null
  providerAccountLabel: string | null
  credentialLast4: string | null
  validatedAt: string | null
  updatedAt: string | null
}

type CobrosMercadoPagoResource = {
  provider: 'mercadopago'
  payment_account: CompanyMercadoPagoConnection | null
  marketplace_fee: {
    configured: boolean
    mode: 'percentage' | 'fixed' | 'hybrid' | null
    percentage: number | null
    fixedAmount: number | null
    editable: false
  }
  sales_readiness: {
    status: string
    reason: string | null
    canSell: boolean
  }
}
```

### OAuth endpoints

- `POST /api/cobros/mercadopago/oauth/start`
  - input: company context from authenticated user
  - output: redirect or `{ authUrl }`

- `GET /api/cobros/mercadopago/oauth/callback?code=...&state=...`
  - input: provider callback params
  - output: dashboard redirect with stable success/failure outcome

- `DELETE /api/cobros/mercadopago`
  - output: disconnected company resource

### Owner fee source

Fase 1 recomendada:
- tabla propia tipo `platform_marketplace_fee_settings` o equivalente,
- o config interna del backend si todavía no existe superficie admin.

Requisito de dominio:
- la empresa nunca muta esta fuente,
- `resolveMarketplaceFee()` solo lee de ella,
- el checkout persiste snapshot del fee resuelto por operación.

## Validation & Error Handling

- Callback OAuth inválido o cancelado → resultado estable no sellable; nunca exponer errores raw de MP al tenant.
- Conexión reconectada → invalida readiness previa y la vuelve a evaluar.
- Fee owner-controlled faltante o inválido → empresa no vendible aunque el seller esté conectado.
- `DELETE` disconnect → quita posibilidad de vender, pero no borra fee owner-controlled.
- Dashboard tenant no puede enviar `marketplaceFeeMode`, `marketplaceFeePercentage` ni `marketplaceFeeFixedAmount`; si lo intenta, backend debe rechazarlo o ignorarlo explícitamente.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Resolución de readiness con seller conectado/desconectado y fee disponible/no disponible | Tests de helpers en `sales-readiness` y `marketplace-fee` |
| Unit | Normalización de callback OAuth y persistencia de conexión | Tests de `payment-accounts`/OAuth helpers con mocks de exchange |
| Integration | `oauth/start`, `oauth/callback`, `disconnect`, `GET /cobros/mercadopago` | Requests autenticados con mocks de Mercado Pago |
| Integration | Checkout usando cuenta empresa + fee owner-controlled | Assertions sobre payload `marketplace_fee` y bloqueo cuando falta conexión o fee |
| UI | Dashboard de cobros sin inputs de token/fee editables | Prueba manual o tests de componente según cobertura disponible |

## Migration / Rollout

Fase 1: separar fee del owner del modelo tenant actual; dejar dashboard tenant solo lectura para fee.  
Fase 2: agregar endpoints y persistencia OAuth; mantener fallback temporal si hay empresas con token manual preexistente.  
Fase 3: migrar UI tenant a botón `Conectar Mercado Pago`, reconexión y desconexión.  
Fase 4: apagar definitivamente el camino de token manual y limpiar contratos viejos.

## Open Questions

- [ ] Confirmar si Mercado Pago entregará `refresh_token` y expiración utilizable en este flujo para persistir lifecycle completo.
- [ ] Confirmar si la primera versión del fee owner-controlled vive en tabla nueva o env/config interna del backend.
