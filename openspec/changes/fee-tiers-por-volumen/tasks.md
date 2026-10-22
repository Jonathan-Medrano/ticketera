# Tasks — Comisiones por volumen (fee tiers)

Convención del repo: agrupar por fase, numeración jerárquica, `[DB]` en las
tareas de base de datos.

---

## Estado al 2026-08-12

**Implementado y verificado en local:**

| Fase | Estado |
|---|---|
| 1 — Backend DB | ✅ completa. Migración auditada (se removió un `ALTER` de drift ajeno), seed con `activo=false`, schemas sincronizados. |
| 2 — Motor de tiers | ✅ completa. `lib/fee-tiers.ts` + `jobs/feeTierEvaluationJob.ts` (lock 9003), registrado en `index.ts`. |
| 3 — API super-admin | ✅ completa. `routes/platform/fee-tiers.ts`, montada, con capabilities y auditoría. |
| 4 — Frontend | 🚧 parcial: escalera editable + cola de descensos + link en sidebar. **Faltan 4.3 (historial por empresa) y 4.4 (control de pinned)** — la API existe, falta la UI. |
| 5 — Legal | ✅ 5.1 y 5.2 hechas. Se corrigió además una afirmación FALSA en los T&C ("Ticketera no ofrece compra anticipada de consumibles"). 5.3 pendiente de decisión. |
| 6 — Testing | 🚧 20 tests propios en verde (incluye no-retroactividad). **Baseline del repo: 131 fallas preexistentes**, ajenas a este change. |
| 7 — Infra / deploy | ⬜ no iniciada. Requiere confirmación del dueño + verificación de backup. |

**Verificación del delta sobre el baseline** (medido con y sin el change):

```
baseline:      440 tests · 309 pass · 131 fail
con el change: 460 tests · 329 pass · 131 fail
delta:         +20 tests · +20 pass ·  +0 fail
```

**Bloqueante para 7.6 (activar la escalera):** decidir 5.3 y resolver las 131
fallas del baseline, que hoy dejan al repo sin red de seguridad real.

---

## Fase 1 — Backend DB

- [ ] **1.1 [DB]** Agregar `PlatformFeeTier`, `EmpresaFeeTierState` y
      `EmpresaFeeTierEvent` a `backend/prisma/schema.prisma` (ver `design.md`).
- [ ] **1.2 [DB]** `npx prisma migrate dev --name fee_tiers_por_volumen`
      **contra la base de test local únicamente**.
- [ ] **1.3 [DB]** Auditar el SQL generado: debe contener **solo**
      `CREATE TABLE` / `CREATE INDEX`. Si aparece un `DROP` o un `ALTER` sobre
      una tabla existente → **FRENAR** y reportar drift.
- [ ] **1.4 [DB]** Seed idempotente de los 3 tiers semilla con `activo = false`.
- [ ] **1.5 [DB]** `node scripts/sync-prisma-schemas.mjs --write` desde la raíz y
      verificar con `npm run prisma:sync:check`.

## Fase 2 — Backend: motor de tiers

- [ ] **2.1** `backend/src/lib/fee-tiers.ts`:
  - [ ] 2.1.1 `getTiersActivos()` — escalera ordenada por umbral.
  - [ ] 2.1.2 `validarEscalera()` — R1.3 (umbral único), R1.4 (tier base
        indeleble), R1.5 (rango 0-100), R1.6 (advertencia de monotonía).
  - [ ] 2.1.3 `calcularVolumenPorEmpresa()` — la query agregada de `design.md`.
  - [ ] 2.1.4 `resolverTier(volumen, tiers)` — función pura, sin I/O.
  - [ ] 2.1.5 `aplicarCambioDeTier()` — UPSERT del override + INSERT de
        auditoría **en la misma transacción**.
- [ ] **2.2** `backend/src/jobs/feeTierEvaluationJob.ts`, calcado de
      `marketingCarritoAbandonadoJob.ts`:
  - [ ] 2.2.1 `pg_try_advisory_lock(9003)` sobre `prismaDirectUrl`, release en
        `finally`.
  - [ ] 2.2.2 `shouldStartFeeTierEvaluationJob()` — opt-out por
        `FEE_TIER_EVALUATION_ENABLED=0`, off en tests, off en modo migración.
  - [ ] 2.2.3 Ratchet: ascenso automático / descenso a cola (R3, R4).
  - [ ] 2.2.4 Respetar `pinned` (R5.2) pero igual registrar volumen (R5.3).
  - [ ] 2.2.5 Una transacción por empresa; un error no aborta la corrida (R6.6).
  - [ ] 2.2.6 `platform_messages` al ascender (R3.4).
- [ ] **2.3** Registrar el job en `backend/src/index.ts` junto a los existentes.
- [ ] **2.4** Actualizar el registro de advisory locks en `CLAUDE.md` con
      `9003 → fee-tier-evaluation`.

## Fase 3 — Backend: API de super-admin

- [ ] **3.1** `GET/PUT /platform/configuracion/fee-tiers` — leer y editar la
      escalera. Capability: `platform.fees.defaults.edit`.
- [ ] **3.2** `GET /platform/fee-tiers/pendientes` — cola de descensos.
- [ ] **3.3** `POST /platform/fee-tiers/pendientes/:empresaId/aplicar` —
      aplicar un descenso. Capability: `platform.companies.overrides.edit`.
      Auditoría con origen `'admin'` (R4.4).
- [ ] **3.4** `POST /platform/fee-tiers/:empresaId/pin` y `/unpin` (R5.4).
- [ ] **3.5** `GET /platform/fee-tiers/:empresaId/historial` (R7.3).
- [ ] **3.6** Verificar que **toda** ruta nueva exija `x-internal-secret` y pase
      por el middleware de capabilities. Ninguna comisión se cambia sin authz.

## Fase 4 — Frontend (super-admin)

- [ ] **4.1** Pantalla de escalera: tabla editable, validación en vivo, aviso de
      no-monotonía (R1.6). Sigue el patrón card-grid + KPI-strip de
      `roles-content.tsx`.
- [ ] **4.2** Cola de descensos: empresa, tier actual → propuesto, volumen,
      días pendiente, botón aplicar con confirmación por `Dialog`
      (nunca `window.confirm`).
- [ ] **4.3** Historial de tiers en el detalle de empresa.
- [ ] **4.4** Control de `pinned` con motivo obligatorio.
- [ ] **4.5** Porcentajes y conteos con `font-mono tabular-nums`, alineados a la
      derecha en tablas. Fechas por `lib/format.ts` (tz AR).

## Fase 5 — Legal / marketing (BLOQUEANTE del release)

- [ ] **5.1** `terminos/page.tsx`: declarar la comisión de consumibles online
      (hoy ausente) y el esquema de tiers por volumen (R8.1).
- [ ] **5.2** `privacidad/page.tsx`: actualizar la mención de "comisión del 4%
      por venta de entradas", hoy incompleta.
- [ ] **5.3** Decidir si la escalera se publica en `precios/page.tsx`. Si se
      publica, **debe leerse de `platform_fee_tiers`**, no escribirse a mano
      (R8.2) — es exactamente el error que originó todo esto.

## Fase 6 — Testing

- [ ] **6.1** `fee-tiers-volumen.test.ts` — la query de volumen:
      excluye POS presencial, excluye `cancelada`, respeta la ventana de 90d.
- [ ] **6.2** `fee-tiers-resolucion.test.ts` — `resolverTier()` puro: bordes
      exactos del umbral, volumen 0, sin tiers activos.
- [ ] **6.3** `fee-tiers-ratchet.test.ts` — ascenso se aplica; descenso NO se
      aplica; descenso se cancela si el volumen se recupera (R4.5).
- [ ] **6.4** `fee-tiers-pinned.test.ts` — el job no toca una empresa `pinned`
      en ninguna dirección (R5.2).
- [ ] **6.5** `fee-tiers-auditoria.test.ts` — no existe cambio de comisión sin
      su fila de auditoría (invariante transaccional de 2.1.5).
- [ ] **6.6** **Test de no-retroactividad**: entradas y sesiones creadas antes
      del cambio conservan su comisión original (R3.5). *Este es el test que
      protege la propiedad más importante del sistema.*
- [ ] **6.7** `cd backend && npm test` en verde.
- [ ] **6.8** `cd platea && npm run build && cd ../backend && npm run build`.

## Fase 7 — Infra / despliegue

- [ ] **7.1** **Verificar backup de Supabase** (Database → Backups) antes de
      cualquier migración. Confirmación explícita del dueño.
- [ ] **7.2** `FEE_TIER_EVALUATION_ENABLED=0` en Fly **antes** de deployar.
      El código llega apagado.
- [ ] **7.3** Deploy backend (Fly corre `migrate deploy` al reiniciar).
      **Confirmar con el dueño antes de pushear** — la cuenta del CLI de Vercel
      cambió recientemente; verificar a qué proyecto/cuenta apunta cada deploy.
- [ ] **7.4** Verificar en prod que los conteos de volumen son correctos, con la
      escalera todavía inactiva.
- [ ] **7.5** Activar el job. Revisar una corrida completa en la auditoría.
- [ ] **7.6** Activar la escalera (`activo = true`) recién con 5.1 y 5.2 hechas.
- [ ] **7.7** Actualizar `PRODUCT.md`, `TICKETERA-AGENT.md` y `features/` con el
      modelo de comisión por volumen.

---

## Orden de ejecución

Fases 1 → 2 → 6 (tests) antes de tocar frontend. El motor tiene que estar
verificado antes de construirle una UI encima.

La fase 5 no es opcional ni cosmética: **bloquea el paso 7.6**. Activar tiers
sin declararlos en los T&C repite —agravado— el problema que originó todo esto.
