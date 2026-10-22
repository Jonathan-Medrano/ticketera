# Design: Super Admin Platform Console

## Technical Approach

Agregar una consola global del owner separada del dashboard empresa actual, pero reutilizando el login general existente. La autenticación no tendrá signup público nuevo: el backend resolverá si la identidad autenticada es un super-admin mediante datos persistidos internamente. Sobre esa identidad se expondrán endpoints y pantallas exclusivas del owner. La comisión marketplace por empresa migrará desde env/config interna a una fuente persistida de plataforma y seguirá siendo consumida por el flujo ya existente de readiness y checkout. En paralelo, la consola del owner tendrá un dashboard global de ganancias, un directorio de empresas y un módulo de configuración de la cuenta Mercado Pago del owner.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Reutilizar el login general para super-admin | Crear login separado para owner | Reusar el flujo actual simplifica onboarding interno y reduce duplicación de auth. La diferencia real debe vivir en identidad/autorización, no en otra pantalla de login. |
| Marcar super-admin en datos persistidos internos | Hardcodear emails o usar env vars | Hardcodear identidad de owner es frágil y poco auditable. Persistirlo permite trazabilidad, crecimiento controlado y eventual self-management interno. |
| Crear consola global separada del dashboard empresa | Reutilizar dashboard empresa con permisos especiales | El owner ve métricas globales y manipula datos cross-tenant; mezclar ambas superficies genera permisos ambiguos y riesgo de fuga de datos. |
| Persistir comisión marketplace por empresa en storage de plataforma | Mantener `MARKETPLACE_FEE_*` en env | El owner necesita editar comisión por empresa desde UI. Eso exige persistencia administrable, no config estática. |
| Mantener fee owner-controlled como input del flujo existente de checkout/readiness | Crear segundo pipeline de cobros solo para owner | El pipeline actual ya resuelve readiness + checkout por empresa. Lo correcto es inyectar una fuente nueva de fee, no duplicar la arquitectura. |
| Separar cuenta MP del owner de cuentas seller de empresas | Reusar la misma tabla/contrato de tenant sellers sin distinción | El owner-side payment account tiene otro ownership y otra UX. Puede compartir primitives de cifrado, pero no debe confundirse con cuentas seller tenant-scoped. |

## Data Flow

Login general → backend resuelve identidad → si cuenta marcada como super-admin → sesión owner → rutas `/super-admin/*`.

Super-admin dashboard:
1. Frontend owner pide resumen global
2. Backend agrega ventas, comisiones de plataforma y breakdown temporal
3. UI renderiza métricas/cards/charts

Fee por empresa:
1. Super-admin edita comisión en consola global
2. Backend persiste config por empresa
3. `resolveMarketplaceFee(empresaId, subtotal)` usa esa config
4. `getSalesReadiness(empresaId)` sigue exigiendo fee resoluble + seller conectado
5. Checkout crea `Preference` con `marketplace_fee`

Cuenta MP owner:
1. Super-admin abre settings owner
2. Backend devuelve estado masked de la cuenta owner
3. Super-admin actualiza la cuenta
4. Backend persiste/cifra sin tocar seller accounts tenant

## File Changes

| File | Action | Description |
|---|---|---|
| `actualizar db.sql` | Modify | Agregar modelo persistido para super-admin y fee marketplace por empresa; posiblemente storage para cuenta MP owner. |
| `backend/src/routes/auth.ts` y/o auth helpers | Modify | Resolver identidad de super-admin en el login general. |
| `backend/src/lib/marketplace-fee.ts` | Modify | Reemplazar env vars por fee persistido por empresa, con fallback/migración segura si hace falta. |
| `backend/src/lib/sales-readiness.ts` | Modify | Mantener readiness compatible con fee por empresa persistido. |
| `backend/src/lib/payment-accounts.ts` o nueva abstracción | Modify/New | Reutilizar cifrado/lectura para cuenta MP owner sin mezclarla con sellers tenant. |
| `backend/src/routes/super-admin-*.ts` | Create | Endpoints owner-only: dashboard global, empresas, ganancias por empresa, fee por empresa, cuenta MP owner. |
| `backend/src/routes/index.ts` | Modify | Registrar la nueva superficie owner. |
| `platea/auth.ts` | Modify | Reconocer la sesión super-admin para enrutar correctamente. |
| `platea/app/(super-admin)/*` | Create | Layout, dashboard y páginas del owner. |
| `platea/components/super-admin/*` | Create | Cards, charts, tabla de empresas, modal de ganancias, form de fee y settings de cuenta owner. |

## Interfaces / Contracts

### Super-admin identity

```ts
type PlatformUserType = 'empresa' | 'empleado' | 'comprador' | 'super_admin'
```

La sesión debe distinguir claramente al super-admin del resto de identidades y NO derivarlo implícitamente desde empresa/empleado.

### Dashboard global

```ts
type SuperAdminDashboardResponse = {
  metricas: {
    empresasActivas: number
    ventasTotales: number
    volumenBruto: number
    gananciasOwner: number
  }
  gananciasPorDia: Array<{ dia: string; total: number }>
  gananciasPorEmpresaTop: Array<{ empresaId: string; empresaNombre: string; total: number }>
  empresasResumen: Array<{ id: string; nombre: string; slug: string; estadoCobros: string; comisionMarketplace: number | null }>
}
```

### Directorio de empresas

```ts
type SuperAdminCompanyRow = {
  id: string
  nombre: string
  slug: string
  activa: boolean
  salesReadiness: string | null
  marketplaceFee: {
    mode: 'percentage' | 'fixed' | 'hybrid' | null
    percentage: number | null
    fixedAmount: number | null
  }
  gananciasOwner: number
}
```

### Modal de ganancias por empresa

```ts
type CompanyGainDetail = {
  empresaId: string
  empresaNombre: string
  volumenBruto: number
  gananciasOwner: number
  ventas: number
  serieTemporal: Array<{ dia: string; total: number }>
}
```

### Fee por empresa

La comisión marketplace deja de depender de env vars globales y pasa a una fuente persistida tipo:
- `empresa_marketplace_fees`
  - `empresa_id`
  - `mode`
  - `percentage`
  - `fixed_amount`
  - `updated_by_super_admin_id`
  - timestamps

### Cuenta MP owner

Puede modelarse en tabla dedicada o en extensión reutilizable de payment accounts, pero con owner distinto de empresa tenant. Requisito: jamás debe sobrescribir ni compartir accidentalmente el vínculo seller de una empresa.

## Validation & Error Handling

- Usuario autenticado no super-admin pidiendo `/super-admin/*` → `403` o redirect estable.
- Fee de empresa inválido → `400`, no persiste, no impacta readiness/checkouts existentes.
- Empresa sin fee persistido después de migración → fallback controlado o no-vendible explícito, según fase de rollout.
- Cuenta MP owner inválida → error aislado al módulo owner; no debe romper seller connections de empresas.
- Modal de ganancias por empresa con empresa inexistente → `404` estable.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | Resolución de identidad super-admin | Tests de auth/session helpers |
| Unit | Fee por empresa + fallback/migración | Tests de `marketplace-fee` |
| Integration | Acceso y protección de rutas `/super-admin/*` | Requests autenticados con distintos user types |
| Integration | Dashboard global y directorio de empresas | Assertions sobre agregados, listas y filtros |
| Integration | Update fee por empresa y efecto en readiness/checkout | Configurar fee, luego validar `resolveMarketplaceFee()` / checkout |
| Integration | Cuenta MP owner | Persistencia masked y aislamiento respecto a seller accounts tenant |
| UI | Dashboard owner, tabla, modal, form fee | Tests de componente o validación manual guiada |

## Migration / Rollout

Fase 1: introducir identidad super-admin y storage de fee por empresa, con migración/fallback desde env si hace falta.  
Fase 2: mover `resolveMarketplaceFee()` a storage persistido y mantener checkout/readiness compatible.  
Fase 3: construir consola global owner con dashboard/listado/modal/config fee.  
Fase 4: agregar settings de cuenta MP owner y remover dependencia operacional de env para la comisión.

## Open Questions

- [ ] Definir el storage exacto de super-admin: columna/flag en tabla existente o tabla dedicada de identities owner.
- [ ] Definir qué significa exactamente “ganancias” en dashboard owner: comisión cobrada teórica, comisión de ventas confirmadas, o comisión de pagos aprobados reconciliados.
- [ ] Definir si la cuenta MP owner será solo configuración informativa inicial o si tendrá un uso operativo inmediato dentro del producto.
