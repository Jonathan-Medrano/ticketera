# Diseño — Comisiones por volumen (fee tiers)

## Principio rector

**No tocar el camino del dinero.**

La feature no modifica `marketplace-fee.ts`, ni la creación de preferences de
Mercado Pago, ni el webhook, ni `checkout_sessions`. El job escribe en
`empresa_marketplace_fee_overrides` y la **cascada de resolución que ya existe**
hace todo lo demás.

Esto no es una comodidad: es la decisión de arquitectura que hace la feature
segura. Si el motor de tiers tuviera un bug, el peor caso es *un porcentaje mal
escrito en una tabla de configuración* — nunca una venta corrompida.

## Cómo se conecta con lo que ya existe

```
                      ┌───────────────────────────────┐
   NUEVO ─────────►   │  feeTierEvaluationJob         │
                      │  (diario · advisory lock 9003)│
                      └───────────────┬───────────────┘
                                      │ UPSERT percentage
                                      ▼
                      ┌───────────────────────────────┐
   YA EXISTE          │ empresa_marketplace_fee_       │
                      │ overrides  (empresa × flow)    │
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
   YA EXISTE          │ resolveMarketplaceFeeConfig    │
                      │ ByEmpresaId()                  │
                      │ override → default → env       │
                      └───────────────┬───────────────┘
                                      │
                                      ▼
                      ┌───────────────────────────────┐
   YA EXISTE          │ checkout: sessionData.         │
                      │ marketplaceFee  ← CONGELADO    │
                      └───────────────────────────────┘
```

El punto marcado como **CONGELADO** es la garantía de no-retroactividad: la
comisión se resuelve y se guarda en la sesión al crearla. Cambiar el override
después no puede alterar una sesión ya creada, ni una venta ya confirmada.

## Modelo de datos

Tres tablas nuevas. Cero `ALTER` sobre tablas existentes.

```prisma
/// Escalera de comisiones por volumen. Editable desde super-admin sin deploy.
/// Un umbral de comisión es un parámetro comercial, no una constante de código.
model PlatformFeeTier {
  id               String   @id @db.VarChar(36)
  nombre           String   @db.VarChar(60)
  /// Entradas online no canceladas en ventana rolling de 90 días.
  /// En CANTIDAD, no en ARS: un umbral en pesos se autodesactualiza con la inflación.
  min_entradas_90d Int
  pct_entradas     Decimal  @db.Decimal(5, 2)
  pct_consumibles  Decimal  @db.Decimal(5, 2)
  activo           Boolean  @default(false)
  orden            Int      @default(0)
  created_at       DateTime @default(now()) @db.Timestamptz()
  updated_at       DateTime @updatedAt @db.Timestamptz()

  @@unique([min_entradas_90d])
  @@index([activo, min_entradas_90d])
  @@map("platform_fee_tiers")
}

/// Estado de tier por empresa: qué tier tiene, qué volumen midió la última
/// evaluación, si hay un descenso esperando aprobación, y si está pinned.
model EmpresaFeeTierState {
  empresa_id               String    @id @db.VarChar(36)
  current_tier_id          String?   @db.VarChar(36)
  entradas_ventana         Int       @default(0)
  evaluated_at             DateTime? @db.Timestamptz()
  /// Descenso detectado y NO aplicado. Espera aprobación humana (ratchet).
  pending_downgrade_tier_id String?  @db.VarChar(36)
  pending_desde            DateTime? @db.Timestamptz()
  /// Comisión negociada a mano: el job NUNCA la toca.
  pinned                   Boolean   @default(false)
  pinned_por               String?   @db.VarChar(36)
  pinned_motivo            String?   @db.VarChar(200)
  updated_at               DateTime  @updatedAt @db.Timestamptz()

  @@index([pending_downgrade_tier_id])
  @@index([pinned])
  @@map("empresa_fee_tier_state")
}

/// Auditoría inmutable. Solo INSERT.
/// En código que mueve plata, tenés que poder responder
/// "¿por qué esta empresa pagó 3,5% el 12 de marzo?".
model EmpresaFeeTierEvent {
  id               String   @id @db.VarChar(36)
  empresa_id       String   @db.VarChar(36)
  flow             String   @db.VarChar(40)
  pct_anterior     Decimal? @db.Decimal(5, 2)
  pct_nuevo        Decimal  @db.Decimal(5, 2)
  tier_id          String?  @db.VarChar(36)
  tier_nombre      String?  @db.VarChar(60)
  entradas_ventana Int
  /// 'system' (job) | 'admin' (aprobación manual de descenso)
  origen           String   @db.VarChar(20)
  aplicado_por     String?  @db.VarChar(36)
  created_at       DateTime @default(now()) @db.Timestamptz()

  @@index([empresa_id, created_at])
  @@index([origen])
  @@map("empresa_fee_tier_events")
}
```

### Por qué `empresa_id` es la PK de `EmpresaFeeTierState`

Una empresa tiene exactamente un estado de tier. Usar `empresa_id` como PK en
lugar de un `id` sintético + unique hace imposible por construcción que existan
dos filas de estado para la misma empresa. La base garantiza el invariante; no
hace falta código que lo defienda.

### Por qué el tier define ambos flows

El que es "alto volumen" es la **productora**, no el flow. Una sola escalera
manejada por entradas define el porcentaje de entradas *y* de consumibles. La
alternativa (una escalera por flow) duplica la configuración y abre la puerta a
estados incoherentes sin ningún beneficio comercial real.

## Query de volumen

```sql
SELECT e.empresa_id, COUNT(*)::int AS entradas_ventana
FROM entradas en
JOIN eventos e ON e.id = en.evento_id
WHERE en.medio_pago_presencial IS NULL      -- solo online (POS presencial no paga comisión)
  AND en.estado <> 'cancelada'              -- no premiar volumen reembolsado
  AND en.created_at >= now() - interval '90 days'
GROUP BY e.empresa_id
```

Una sola query agregada para todas las empresas, no una por empresa. Con
`entradas.@@index([created_at])` y el join por PK de `eventos`, el costo es
aceptable para una corrida diaria.

> **A revisar en tasks:** si el plan de esta query se degrada al crecer
> `entradas`, el índice a evaluar es
> `(evento_id, estado, created_at) WHERE medio_pago_presencial IS NULL`.
> No se agrega preventivamente: primero se mide.

## Algoritmo de evaluación

```
para cada empresa activa y no es_prueba:

    volumen  := conteo de la query de arriba (0 si no aparece)
    tier     := tier activo con el mayor min_entradas_90d <= volumen

    guardar volumen y evaluated_at en el state    ← siempre, incluso si pinned

    si state.pinned:
        continuar                                  ← R5.2: nunca tocar

    pct_actual := override vigente (o default de plataforma)

    si tier.pct < pct_actual:                      ← ASCENSO
        upsert override (entradas + consumibles)
        insertar 2 eventos de auditoría (origen 'system')
        crear platform_message a la empresa
        limpiar pending_downgrade                  ← R4.5

    si tier.pct > pct_actual:                      ← DESCENSO
        NO tocar el override
        setear pending_downgrade_tier_id + pending_desde

    si tier.pct == pct_actual:
        limpiar pending_downgrade                  ← R4.5
```

### Transaccionalidad

Cada empresa se procesa en su **propia transacción**. Un fallo en la empresa #12
no debe abortar las 49 restantes (R6.6). Dentro de la transacción: el UPSERT del
override y el INSERT de auditoría van juntos — **no puede existir un cambio de
comisión sin su fila de auditoría**.

No hace falta `Serializable` ni `FOR UPDATE`: no hay contención de stock acá.
El advisory lock a nivel job ya garantiza que no hay dos evaluaciones
simultáneas, que es la única carrera real.

## Concurrencia y el advisory lock

Clave **9003**, siguiendo el registro documentado en `CLAUDE.md`:

```
4242 → delivery-retry
7701 → marketing carrito abandonado
8823 → checkoutCleanup
9001 → platform-governance
9002 → platform-profit-sharing
9003 → fee-tier-evaluation      ← NUEVO
```

Patrón copiado de `marketingCarritoAbandonadoJob.ts:85-89`:
`pg_try_advisory_lock` (no bloqueante) sobre `prismaDirectUrl`, liberado en
`finally`. El pooler **no sirve** para esto: PgBouncer en modo transacción no
mantiene la sesión, así que el lock se perdería.

## Estrategia de migración

Aditiva y reversible.

1. `cd backend && npx prisma migrate dev --name fee_tiers_por_volumen`
   → **solo contra la base de test local.** Nunca contra Supabase.
2. Verificar que el SQL generado sea exclusivamente `CREATE TABLE` /
   `CREATE INDEX`. Si aparece cualquier `DROP` o `ALTER` sobre una tabla
   existente, **frenar**: significa drift entre schema y base.
3. `node scripts/sync-prisma-schemas.mjs --write` desde la raíz (sincroniza las
   tres copias del schema).
4. Commit en `backend/`, luego bump del pointer en la raíz.
5. Fly corre `prisma migrate deploy` al reiniciar. `migrate deploy` **nunca
   resetea**: solo aplica migraciones pendientes hacia adelante.

### Seed de la escalera

Los tiers semilla se insertan **con `activo = false`**. La escalera se activa a
mano desde el panel recién después de verificar en prod que los conteos de
volumen son correctos. El job puede correr sin riesgo: sin tiers activos, no
resuelve ningún tier y no toca ninguna comisión.

Esto convierte el despliegue en un no-evento: el código llega apagado.

## Orden de despliegue

```
1. Migración + job APAGADO (FEE_TIER_EVALUATION_ENABLED=0)
2. Verificar en prod que los conteos de volumen dan bien
3. Actualizar T&C  ← BLOQUEANTE (R8.1)
4. Activar el job, con la escalera todavía inactiva
5. Revisar una corrida completa en la auditoría
6. Activar la escalera
```

Cada paso es reversible sin tocar datos de negocio.

## Qué NO se construye en v1

- **Notificación por email.** `platform_messages` alcanza; el email agrega
  dependencia de Resend y plantillas para un evento poco frecuente.
- **Tiers por evento o categoría.** No hay demanda; complica el modelo.
- **Proyección "te faltan N entradas para bajar a 3,5%".** Buena idea de
  producto, pero es superficie de marketing, no del motor. Va después.
