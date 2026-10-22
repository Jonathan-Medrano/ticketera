# Propuesta — Comisiones por volumen (fee tiers automáticos)

**Estado:** propuesta
**Fecha:** 2026-08-11
**Dominio:** pagos / plataforma (super-admin)
**Slug:** `fee-tiers-por-volumen`

## Problema

La página pública de precios ofrecía una comisión reducida del 3% para
"productoras de alto volumen", pero **ese tier no existía como funcionalidad**.
El único mecanismo real es que un admin de plataforma edite a mano
`empresa_marketplace_fee_overrides` desde super-admin, empresa por empresa.

Eso genera tres problemas concretos:

1. **Promesa comercial sin respaldo técnico.** Se prometía un beneficio que
   dependía de que alguien se acordara de aplicarlo.
2. **No escala.** Con 10 empresas es manejable; con 100 es imposible saber
   quién califica sin correr una query a mano.
3. **Inequidad silenciosa.** Dos productoras con el mismo volumen pueden estar
   pagando distinto según si alguien las revisó o no.

> Nota: la copy de `platea/app/(marketing)/precios/page.tsx` ya fue corregida
> (2026-08-11) para eliminar el tier fantasma y exponer el pricing canónico real
> (4% entradas / 3% consumibles online / 0% presencial). Esta propuesta
> **construye** el tier que aquella copy prometía, de forma verificable.

## Objetivo

Que la comisión de una empresa se ajuste **sola** según su volumen real de
ventas, con reglas explícitas, auditables y configurables sin deploy.

## Alcance

### Entra

- Escalera de tiers configurable en base de datos (no hardcodeada).
- Job diario que evalúa el volumen de cada empresa y resuelve su tier.
- **Ascenso automático** (comisión baja): se aplica solo.
- **Descenso asistido** (comisión sube): NO se aplica solo; queda en cola de
  aprobación en super-admin.
- Auditoría completa de cada cambio de comisión.
- Aviso in-app a la empresa cuando su comisión baja.
- Pantallas de super-admin: editar la escalera + resolver la cola de descensos.

### No entra

- Facturación, liquidaciones ni notas de crédito.
- Cambios en el flujo de checkout o en la creación de preferences de Mercado Pago.
- Cambios en la resolución de comisión existente (`marketplace-fee.ts`).
- Notificación por email (v1 usa `platform_messages`, in-app).
- Tiers por evento o por categoría de entrada.

## Decisiones de negocio ya tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Métrica de volumen | **Cantidad de entradas**, no pesos | Un umbral en ARS se autodesactualiza con la inflación argentina: en ~1 año todas las empresas serían "alto volumen" sin vender una entrada más. La cantidad es inflation-proof y es lo que el productor entiende en una reunión. |
| Ventana | Rolling **90 días** | Suaviza la estacionalidad de eventos sin premiar un pico único. |
| Qué entradas cuentan | Online (`medio_pago_presencial IS NULL`) y `estado <> 'cancelada'` | Solo el canal que genera comisión, y sin premiar volumen que después se reembolsó. |
| Comportamiento | **Ratchet**: sube solo, baja con aprobación | Bajarle la comisión a alguien no requiere su consentimiento; subírsela sí. Convierte un riesgo contractual en un problema de UI. |
| Dónde viven los umbrales | Tabla en DB, editable desde super-admin | Un umbral de comisión es un parámetro comercial que se toca varias veces por año. Hardcodearlo obliga a un deploy por cada ajuste. |

## Escalera semilla (ajustable desde el panel)

| Tier | Entradas online / 90d | Entradas | Consumibles |
|---|---|---|---|
| Base | 0 | 4,00 % | 3,00 % |
| Pro | 2.000 | 3,50 % | 2,50 % |
| Alto volumen | 6.000 | 3,00 % | 2,00 % |

Estos valores son **semilla**, no contrato. Se cargan en la migración y se
editan desde el panel sin deploy.

## Impacto en tablas críticas

| Tabla | Impacto |
|---|---|
| `entradas` | **Solo lectura** (COUNT en ventana de 90d). Ninguna escritura, ningún ALTER. |
| `checkout_sessions` | **Ninguno.** |
| `entrada_categorias` | **Ninguno.** |
| `barra_stock` | **Ninguno.** |
| `empresa_marketplace_fee_overrides` | Escritura (UPSERT del `percentage` por flow). Sin cambio de estructura. |

## Impacto en Mercado Pago / auth

- **Mercado Pago:** ninguno en el código de checkout. El job escribe en
  `empresa_marketplace_fee_overrides`; la cascada de resolución existente
  (`marketplace-fee.ts:300`) hace el resto al crear la próxima preference.
- **No hay retroactividad posible.** La comisión se congela en la sesión de
  checkout (`sessionData.marketplaceFee`, `tenant.ts:1144`) al momento de
  crearla. Ninguna venta ya cobrada ni en vuelo puede alterarse. Esta propiedad
  es la que hace segura toda la feature y **debe preservarse**.
- **Auth:** se reutilizan las capabilities existentes
  `platform.fees.defaults.edit` y `platform.companies.overrides.edit`. No se
  crean tipos de usuario ni flujos de login nuevos.

## Riesgos y mitigación

| Riesgo | Severidad | Mitigación |
|---|---|---|
| El job baja la comisión por un conteo mal calculado | **Alta** | Tests de integración sobre la query de volumen con datos sembrados; auditoría con el conteo que motivó cada cambio; la escalera arranca desactivada (`activo = false`) hasta validar en prod. |
| Empresa reclama por una suba de comisión | Alta | El ratchet lo impide: los descensos nunca se aplican solos. |
| Doble ejecución del job (varias máquinas Fly) | Media | `pg_try_advisory_lock(9003)` — mismo patrón que `marketingCarritoAbandonadoJob`. |
| Un override manual/negociado es pisado por el job | **Alta** | `EmpresaFeeTierState.pinned` — si un admin fijó la comisión a mano, el job la respeta y no la toca nunca. |
| Los T&C no declaran el esquema de tiers | Media | Bloquea el release: `terminos/page.tsx` debe actualizarse antes de activar la escalera (ver tasks fase 5). |

## Plan de rollback

La migración es **puramente aditiva**: 3 tablas nuevas
(`platform_fee_tiers`, `empresa_fee_tier_state`, `empresa_fee_tier_events`).
No hay `ALTER`, `DROP` ni `RENAME` sobre ninguna tabla existente.

Rollback en tres niveles, de más barato a más caro:

1. **Apagar el job** — `FEE_TIER_EVALUATION_ENABLED=0` en Fly y reiniciar.
   Las comisiones quedan donde estén. Sin deploy de código.
2. **Desactivar la escalera** — `UPDATE platform_fee_tiers SET activo = false`.
   El job corre pero no resuelve ningún tier.
3. **Revertir comisiones** — `empresa_fee_tier_events` guarda el `pct` anterior
   de cada cambio, así que se puede restaurar el estado previo por empresa con
   una query. Las 3 tablas se pueden dropear sin tocar datos de negocio.

**Ninguna variante del rollback puede afectar entradas, compradores ni ventas.**

## Criterios de éxito

- Una empresa que cruza un umbral tiene su comisión reducida en la corrida
  siguiente del job, sin intervención humana.
- Una empresa cuyo volumen cae **no** ve su comisión subir hasta que un admin lo
  aprueba explícitamente.
- Cada cambio de comisión es rastreable: quién/qué lo hizo, cuándo, con qué
  conteo y desde/hacia qué porcentaje.
- Los umbrales se modifican desde el panel sin deploy.
- `cd backend && npm test` en verde.
