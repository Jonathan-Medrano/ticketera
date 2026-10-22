# AGENTE DB — DATABASE, CONSISTENCIA Y PERFORMANCE

## Propósito
Trabajá con este agente cuando el problema viva principalmente en la base de datos real del sistema: tablas, side effects, transacciones, locks, reservas, stock, reconciliación o queries críticas.

## Stack de base de datos
- **Motor**: PostgreSQL en Supabase
- **ORM**: Prisma (`prisma/schema.prisma` — fuente de verdad del schema)
- **Migrations**: `prisma/migrations/` — versionadas, aplicadas con `prisma migrate deploy`
- **Dos clientes** en `backend/src/lib/prisma.ts`:
  - `prisma` → pooler Supabase (puerto 6543). Para queries normales. **NUNCA para `FOR UPDATE`.**
  - `prismaDirectUrl` → directo (puerto 5432). Obligatorio para `FOR UPDATE`, advisory locks y migrations.
- **Sin DDL en runtime**: `backend-schema.ts` está stubbed; todo cambio de schema va por migration versionada.

## Cuándo usarlo
- oversell o stock negativo
- reservas colgadas o cleanup roto
- pagos confirmados tarde o mal reconciliados
- deadlocks, lock wait, `P2034` retries o errores de serialización
- slow queries o índices faltantes
- dudas de estados como `needs_review`, `expirada`, `cancelada`, `confirmada`
- confusión entre cliente pooler y directo

## Cuándo NO usarlo
- si el foco principal es UI, rutas o componentes → usar `../platea/frontend-agent.md`
- si el foco principal es contrato API o middlewares Express sin profundidad SQL → usar `backend-agent.md`

## Fuentes de verdad
- `../database.txt` — schema completo, tabla por tabla, flujos y convenciones de tipos
- `../queries-criticas.txt` — patrones Prisma para cada operación crítica, índices, riesgos
- `../backend.txt` para correlacionar endpoint → side effects
- `prisma/schema.prisma` — definición canónica de modelos e índices

## Qué cubre

### Superficie técnica
- tablas y relaciones
- columnas críticas y convenciones de tipo (Timestamptz, Decimal 12,2, Boolean, JsonB, VarChar 36)
- `FOR UPDATE` con `prismaDirectUrl.$transaction` + Serializable
- `withSerializableRetry` para `P2034`
- advisory locks Postgres (`pg_advisory_xact_lock`)
- idempotencia
- expiración y cleanup
- índices definidos en schema.prisma
- performance (EXPLAIN ANALYZE, pg_stat_statements)
- consistencia de stock y pagos

### Tablas más sensibles
- `checkout_sessions`
- `entrada_categorias`
- `barra_stock`
- `consumibles_ventas`
- `empresa_payment_accounts`

### Columnas que gobiernan comportamiento
- `stock_disponible`
- `stock_actual`
- `estado`
- `activo` / `activa`
- `venta_consumibles_habilitada`
- `reconciliation_status`
- `expires_at`
- `password_changed_at`

### Flujos críticos
- reserva de entradas
- reserva de consumibles
- cleanup de reservas expiradas
- confirmación de pago
- venta manual de consumibles
- canje de consumibles
- escaneo de entradas
- password reset
- rate limiting persistente

## Patrón canónico FOR UPDATE

```ts
await withSerializableRetry(() =>
  prismaDirectUrl.$transaction(async (tx) => {
    // 1. Adquirir lock
    await tx.$queryRaw`SELECT id FROM tabla WHERE id = ${id} FOR UPDATE`
    // 2. Leer estado
    const row = await tx.tabla.findUnique({ where: { id } })
    // 3. Validar
    // 4. Mutar
    await tx.$executeRaw`UPDATE tabla SET col = col - ${n} WHERE id = ${id}`
  }, { isolationLevel: 'Serializable', maxWait: 5000, timeout: 10000 })
)
```

**Regla de oro**: `prismaDirectUrl` SIEMPRE para `FOR UPDATE`. El pooler (PgBouncer, puerto 6543) rompe los session-level locks.

## Registro de advisory locks

| Clave | Dueño |
|-------|-------|
| `4242` | delivery-retry |
| `7701` | marketing carrito abandonado |
| `8823` | checkoutCleanup |
| `9001` | platform-governance |
| `9002` | platform-profit-sharing |

## Errores Prisma → HTTP

| Código | Significado | Respuesta |
|--------|-------------|-----------|
| `P2002` | unique violation | 409 |
| `P2003` | FK violation | 400 |
| `P2025` | record not found | 404 |
| `P2034` | serialization failure | retry con `withSerializableRetry`, luego 503 |

## Señales rápidas
- lock wait / deadlock → revisar si se está usando `prismaDirectUrl`
- reserva retenida → revisar cleanup y advisory lock `8823`
- `needs_review` → incidente operativo en `confirmarPagoLogic`
- sobreventa / stock fantasma → revisar `FOR UPDATE` + Serializable en checkout
- `P2034` frecuente → revisar `withSerializableRetry` en el path
- query lenta → `EXPLAIN ANALYZE` + revisar índices en `schema.prisma`
- índice ausente → agregar en schema + migration nueva

## Hotspots de producción
- `checkout_sessions` — corazón transaccional
- `barra_stock` — decremento concurrente desde múltiples paths
- `entrada_categorias` — candado real del ticketing
- `consumibles_ventas` — historial + canje
- `rate_limit_buckets` — hotspot bajo ataque

## Convenciones de tipos en Prisma/Postgres
- Fechas: `DateTime @db.Timestamptz()` → siempre zona UTC
- Dinero: `Decimal @db.Decimal(12, 2)` → nunca Float para plata
- Booleanos: `Boolean` → reemplaza `TINYINT(1)`
- IDs UUID: `String @id @db.VarChar(36)`
- JSON: `Json @db.JsonB` → indexable con operadores `@>`, `?`, etc.
- `updated_at`: gestionado por trigger Postgres `set_updated_at()`, no por Prisma `@updatedAt` (que es solo informativo)
- Slugs y emails: almacenados lowercase; lookups siempre con `.trim().toLowerCase()`

## Protocolo de trabajo
1. Identificá la tabla fuente de verdad del problema.
2. Identificá la columna de estado que gobierna el flow.
3. Verificá qué operación hace el primer `FOR UPDATE` y si usa `prismaDirectUrl`.
4. Revisá qué flujos compiten por las mismas filas.
5. Revisá cleanup, compensación e idempotencia.
6. Recién después proponé fix.

## Checklist antes de un fix de concurrencia
- ¿Qué tabla es fuente de verdad?
- ¿Qué columna define el estado?
- ¿Qué operación toma lock y con qué cliente?
- ¿Qué otra operación compite por las mismas filas?
- ¿Qué cleanup o compensación existe?
- ¿Qué pasa si la request se reintenta? (`P2034`, `P2002`)
- ¿El advisory lock correspondiente está en el registro?

## Checklist antes de un cambio de schema
- Editar `prisma/schema.prisma`
- Correr `npx prisma migrate dev --name <slug>` en dev
- Commitear schema + directorio `prisma/migrations/<timestamp>_<slug>/`
- En prod: `npx prisma migrate deploy` via CI/CD antes de iniciar la app
- NUNCA alterar tablas manualmente en producción

## Reglas de trabajo
- Marcá explícitamente qué está verificado (en schema.prisma) y qué es inferido.
- Si el síntoma viene desde UX pero el problema es stock, pago o duplicación, quedate acá hasta entender la consistencia.
- No des fixes de concurrencia sin pensar en retries (`P2034`), cleanup e idempotencia.
- No asumas que un índice existe porque el código lo necesita; verificá en `schema.prisma`.
- FULLTEXT en consumibles usa `pg_trgm` GIN index + `ILIKE` + `similarity()` — no `MATCH AGAINST`.

## Anti-patrones
- NO usar `prisma` (pooler) para `FOR UPDATE` — PgBouncer lo rompe.
- NO analizar pagos sin revisar `checkout_sessions`.
- NO tocar stock como si fuera un integer suelto; siempre entender el flujo que lo mueve.
- NO confundir "tabla principal" con "tabla fuente de verdad".
- NO dar fixes de concurrencia sin modelar `P2034`, cleanup e idempotencia.
- NO agregar DDL en runtime — todo va por migration versionada.

## Orden sugerido de lectura
1. `../database.txt`
2. `../queries-criticas.txt`
3. endpoint correlacionado en `../backend.txt`
4. archivo de código del flow concreto (`tenant.ts`, `vender.ts`, `consumibles-redeem.ts`, etc.)
5. `prisma/schema.prisma` para confirmar índices y tipos

## Resumen operativo
Usá este agente cuando el problema sea de integridad real del negocio. Si hay stock, reservas, pagos, locks o rendimiento SQL, este agente tiene prioridad sobre cualquier otro.
El stack es Postgres/Prisma — cualquier referencia a MySQL en el código heredado (tests, comentarios) es legacy y está siendo migrada.
