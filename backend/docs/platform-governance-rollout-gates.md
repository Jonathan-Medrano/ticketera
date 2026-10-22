# Platform governance rollout gates

## Goal
Retirar lecturas legacy de `empresa_marketplace_fees` y de los env `MARKETPLACE_FEE_*` SIN romper checkout, reporting owner ni readiness comercial.

## Gate 1 — Bootstrap verificado
- `ensureBackendSchema()` debe crear/normalizar `platform_admin_users`, `platform_marketplace_fee_defaults`, `empresa_marketplace_fee_overrides` y columnas `consumibles_ventas.owner_fee_*` en la DB de test aislada.
- El seed singleton `superadmin / 12345678` debe existir una sola vez.

## Gate 2 — Backfill estable
- Cada fila legacy de `empresa_marketplace_fees` debe quedar duplicada en `empresa_marketplace_fee_overrides` para ambos flows (`entradas`, `consumibles`).
- Los defaults globales deben existir por flow antes de depender de ellos en readiness o reporting.
- Las ventas históricas de consumibles pueden conservar `owner_fee_* = NULL`; sólo las nuevas confirmaciones deben snapshotear fee owner.

## Gate 3 — Runtime sin drift
- `getSalesReadiness()` debe seguir exigiendo fee configurado en ambos flows.
- `getPlatformDashboardReporting()` y `getPlatformCompanyReporting()` deben seguir sumando entradas + consumibles desde snapshots persistidos.
- Checkout tenant y rutas platform deben seguir resolviendo override empresa primero y default global después.

## Cuándo remover legacy reads
Remové la lectura de `empresa_marketplace_fees` y el fallback `env_legacy` RECIÉN cuando:
1. el bootstrap/backfill pase en la DB de test aislada,
2. exista evidencia de defaults globales por flow en todos los ambientes activos,
3. todas las empresas relevantes tengan override v2 o acepten default global explícito,
4. verify final pase sin depender de fixtures legacy.

Hasta entonces, la lectura legacy sigue siendo una red de seguridad de rollout, NO la fuente de verdad objetivo.
