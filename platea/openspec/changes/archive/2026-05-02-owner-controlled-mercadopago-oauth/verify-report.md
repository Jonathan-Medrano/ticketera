## Verification Report

**Change**: owner-controlled-mercadopago-oauth  
**Version**: N/A  
**Mode**: Standard

---

### Completeness
| Metric | Value |
|--------|-------|
| Tasks total | 18 |
| Tasks complete | 17 |
| Tasks incomplete | 1 |

Incomplete tasks:
- 5.4 Validar manualmente el flujo end-to-end: conectar cuenta empresa, ver fee read-only, vender con fee aplicado, desconectar y bloquear checkout.

---

### Build & Tests Execution

**Build**: ➖ Omitted
```text
No se ejecutó build/type-check global por restricción explícita del entorno: NEVER build after changes.
Se ejecutó lint específico de los archivos tocados en frontend sin errores:
npx eslint "app/(empresa)/dashboard/cobros/page.tsx" "components/dashboard/cobros-content.tsx" "lib/tenant.ts"
```

**Tests**: ✅ 19 passed / ❌ 0 failed / ⚠️ 0 skipped
```text
npm test  (workdir: backend/)

Relevant passing tests for this change:
- payment accounts encrypt/decrypt credentials and redact read models
- sales readiness falls back to missing_provider and prioritizes blocked
- marketplace fee resolves percentage, fixed, rounding, disabled fee and invalid subtotals
- cobros routes reject manual tenant configuration and configuracion exposes owner-controlled fee summary
- cobros oauth start/callback/disconnect manage company connection without exposing secrets
- oauth reconnect replaces previous authorization and keeps owner-controlled fee configuration
- oauth callback failure and pending validation produce stable non-sellable outcomes
- dashboard cobros exposes actionable missing_provider readiness when company is not connected
- tenant public payload stays visible while readiness remains non-sellable
- tenant checkout returns 409 sales_not_ready before creating side effects
- tenant checkout sends the configured marketplace_fee and stores the same snapshot
```

**Coverage**: ➖ Not available

---

### Spec Compliance Matrix

| Requirement | Scenario | Test | Result |
|-------------|----------|------|--------|
| OAuth-based company connection | Start OAuth connection | `backend/src/mercadopago-gating.test.ts > cobros oauth start/callback/disconnect manage company connection without exposing secrets` | ✅ COMPLIANT |
| OAuth-based company connection | Complete OAuth callback successfully | `backend/src/mercadopago-gating.test.ts > cobros oauth start/callback/disconnect manage company connection without exposing secrets` | ✅ COMPLIANT |
| OAuth-based company connection | Reconnect replaces prior company authorization | `backend/src/mercadopago-gating.test.ts > oauth reconnect replaces previous authorization and keeps owner-controlled fee configuration` | ✅ COMPLIANT |
| Safe connection visibility | Dashboard reads connected account state | `backend/src/mercadopago-gating.test.ts > cobros oauth start/callback/disconnect manage company connection without exposing secrets` | ✅ COMPLIANT |
| Safe connection visibility | OAuth callback fails or is rejected | `backend/src/mercadopago-gating.test.ts > oauth callback failure and pending validation produce stable non-sellable outcomes` | ✅ COMPLIANT |
| Disconnect company account | Disconnect removes sellable connection | `backend/src/mercadopago-gating.test.ts > cobros oauth start/callback/disconnect manage company connection without exposing secrets` | ✅ COMPLIANT |
| Platform-owned fee policy | Checkout resolves owner fee | `backend/src/mercadopago-gating.test.ts > tenant checkout sends the configured marketplace_fee and stores the same snapshot` | ✅ COMPLIANT |
| Platform-owned fee policy | Company cannot edit owner fee | `backend/src/mercadopago-gating.test.ts > cobros routes reject manual tenant configuration and configuracion exposes owner-controlled fee summary` | ✅ COMPLIANT |
| Fee policy survives company connection changes | Reconnect keeps fee policy unchanged | `backend/src/mercadopago-gating.test.ts > oauth reconnect replaces previous authorization and keeps owner-controlled fee configuration` | ✅ COMPLIANT |
| Fee policy survives company connection changes | Disconnect keeps owner fee configuration | `backend/src/mercadopago-gating.test.ts > oauth reconnect replaces previous authorization and keeps owner-controlled fee configuration` | ✅ COMPLIANT |
| Fee applied to company checkout target | Ready company creates preference with owner fee | `backend/src/mercadopago-gating.test.ts > tenant checkout sends the configured marketplace_fee and stores the same snapshot` | ✅ COMPLIANT |
| Readiness requires a valid company connection | Company without OAuth connection | `backend/src/mercadopago-gating.test.ts > sales readiness falls back to missing_provider and prioritizes blocked`; `backend/src/mercadopago-gating.test.ts > tenant checkout returns 409 sales_not_ready before creating side effects` | ✅ COMPLIANT |
| Readiness requires a valid company connection | Company connection pending validation | `backend/src/mercadopago-gating.test.ts > oauth callback failure and pending validation produce stable non-sellable outcomes` | ✅ COMPLIANT |
| Readiness includes owner fee availability | Missing owner fee blocks sellability | `backend/src/mercadopago-gating.test.ts > marketplace fee resolves percentage, fixed, rounding, disabled fee and invalid subtotals` | ✅ COMPLIANT |
| Readiness includes owner fee availability | Valid connection and fee enable sales | `backend/src/mercadopago-gating.test.ts > cobros oauth start/callback/disconnect manage company connection without exposing secrets`; `backend/src/mercadopago-gating.test.ts > tenant checkout sends the configured marketplace_fee and stores the same snapshot` | ✅ COMPLIANT |
| Stable readiness contract for clients | Dashboard receives actionable state | `backend/src/mercadopago-gating.test.ts > dashboard cobros exposes actionable missing_provider readiness when company is not connected` | ✅ COMPLIANT |
| Stable readiness contract for clients | Public storefront receives non-sellable visibility | `backend/src/mercadopago-gating.test.ts > tenant public payload stays visible while readiness remains non-sellable` | ✅ COMPLIANT |

**Compliance summary**: 17/17 scenarios compliant

---

### Correctness (Static — Structural Evidence)
| Requirement | Status | Notes |
|------------|--------|-------|
| OAuth connection flow | ✅ Implemented | `backend/src/lib/mercadopago-oauth.ts`, `backend/src/routes/cobros.ts`, Next proxies y dashboard actualizado exponen `oauth/start`, `oauth/callback` y `disconnect`. |
| Owner-controlled fee | ✅ Implemented | `backend/src/lib/marketplace-fee.ts` resuelve fee desde env owner-controlled y `backend/src/routes/cobros.ts` rechaza edición manual tenant. |
| Shared readiness contract | ✅ Implemented | `backend/src/lib/sales-readiness.ts`, `backend/src/routes/tenant.ts`, `backend/src/routes/configuracion.ts` y `platea/lib/tenant.ts` consumen el mismo modelo. |
| Public/dashboard UX coherence | ✅ Implemented | Dashboard de cobros migrado a OAuth + fee read-only; tenant público recibe sellability estable desde backend. |

---

### Coherence (Design)
| Decision | Followed? | Notes |
|----------|-----------|-------|
| Reemplazar token manual por OAuth company-scoped | ✅ Yes | Se agregó flujo `oauth/start` + `oauth/callback`; `POST/PATCH` manuales ahora devuelven 405. |
| Separar fee del owner de `empresa_payment_accounts` | ✅ Yes | El fee sale de `MARKETPLACE_FEE_*`; la tabla de cuentas quedó para la conexión de la empresa. |
| Mantener dashboard empresa con fee read-only | ✅ Yes | `editable: false` en el summary y UI sin inputs de comisión. |
| Resolver fee desde config interna o tabla owner-controlled en Fase 1 | ✅ Yes | Se usó config interna backend, consistente con el design. |
| Conservar readiness compartido backend/public/dashboard | ✅ Yes | La fuente sigue centralizada en `getSalesReadiness()`. |
| Aplicar `marketplace_fee` en Checkout Pro con cuenta OAuth de la empresa | ✅ Yes | `tenant.ts` crea `Preference` con cliente por empresa y usa el snapshot `marketplace_fee`. |

---

### Issues Found

**CRITICAL** (must fix before archive):
- None.

**WARNING** (should fix):
- Falta la validación manual browser-level del flujo completo `Conectar → provider OAuth → callback → dashboard → checkout → disconnect` documentada en la task 5.4.
- El repo frontend mantiene errores globales de lint preexistentes fuera del scope del cambio; no bloquean este verify puntual, pero sí ensucian una validación global posterior.

**SUGGESTION** (nice to have):
- Promover el fee owner-controlled desde env vars a tabla/config admin cuando exista panel del owner.
- Agregar una prueba E2E de navegador cuando el proyecto tenga harness estable para flujos OAuth.

---

### Verdict
**PASS WITH WARNINGS**

La implementación cumple los escenarios del cambio con evidencia runtime automatizada (17/17 compliant); solo queda pendiente la validación manual end-to-end del flujo completo en navegador.
