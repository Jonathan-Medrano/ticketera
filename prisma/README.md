# Prisma — Ticketera / PlateaPro

Schema y migrations de la DB Postgres en Supabase. Vive en el **root del repo** para que tanto `backend/` como `platea/` puedan generarlo y usarlo.

## Layout

```
prisma/
├── schema.prisma     ← Source of truth del schema (modelos + enums + relations)
├── seed.ts           ← Crea el super-admin inicial
├── migrations/       ← Historial de migraciones versionadas (lo crea Prisma)
└── README.md         ← Este archivo
```

## Two-client architecture

Por la decisión del design (`openspec/changes/migrate-to-postgres-prisma/design.md`):

| Variable env  | Puerto | Cuándo usarla                                   |
|---------------|--------|-------------------------------------------------|
| `DATABASE_URL`| 6543   | Runtime queries cortas (default)                |
| `DIRECT_URL`  | 5432   | Migrations + `FOR UPDATE` + advisory locks       |

En código:

```ts
// backend/src/lib/prisma.ts exporta DOS clients:
import { prisma, prismaDirectUrl } from './prisma'

// Query normal → pooler
const empresas = await prisma.empresa.findMany()

// Stock lock → direct connection
await prismaDirectUrl.$transaction(async (tx) => {
  const [cat] = await tx.$queryRaw<{ id: string; stock_disponible: number }[]>`
    SELECT id, stock_disponible
    FROM entrada_categorias
    WHERE id = ${categoryId}
    FOR UPDATE
  `
  if (cat.stock_disponible < quantity) throw new Error('Sin stock')
  await tx.entradaCategoria.update({
    where: { id: categoryId },
    data: { stock_disponible: { decrement: quantity } },
  })
})
```

El frontend (`platea/lib/prisma.ts`) tiene **solo el pooler**. Cualquier operación de lock debe pasar por el backend vía BFF.

---

## Setup inicial — primera vez

### 1. Configurar Supabase

1. Crear proyecto en https://supabase.com/dashboard
2. **Settings → Database** copiar:
   - **Connection string (Transaction)** → port 6543 → será `DATABASE_URL`
   - **Connection string (Session)** o conexión directa → port 5432 → será `DIRECT_URL`
3. Agregar `?pgbouncer=true&connection_limit=1` al final de `DATABASE_URL`
4. Agregar `?sslmode=require&connect_timeout=15` al final de `DIRECT_URL`

Ejemplo:
```
DATABASE_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-xxx.pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://postgres.xxxx:PASSWORD@aws-0-xxx.pooler.supabase.com:5432/postgres?sslmode=require&connect_timeout=15"
```

### 2. Instalar dependencias

```bash
# Backend
cd backend
npm install
npx prisma generate --schema=../prisma/schema.prisma

# Frontend
cd ../platea
npm install
npx prisma generate --schema=../prisma/schema.prisma
```

### 3. Crear el schema en Supabase

```bash
cd backend
npx prisma migrate deploy --schema=../prisma/schema.prisma
```

Esto:
- Lee `prisma/migrations/` y aplica las migrations pendientes
- Conecta usando `DIRECT_URL` (port 5432) — el pooler no soporta DDL

### 4. Seed del super-admin

Antes de correr el seed, exportá las env del super-admin:

```bash
# Linux/Mac
export SUPERADMIN_EMAIL="admin@ticketera.com"
export SUPERADMIN_PASSWORD="EL_PASSWORD_DE_SECRETS-GENERADOS.txt"

# Windows PowerShell
$env:SUPERADMIN_EMAIL = "admin@ticketera.com"
$env:SUPERADMIN_PASSWORD = "EL_PASSWORD_DE_SECRETS-GENERADOS.txt"
```

Y corré:

```bash
cd backend
npx prisma db seed --schema=../prisma/schema.prisma
```

Output esperado:
```json
{
  "ok": true,
  "seeded": "platform_admin_users (superadmin)",
  "id": "<uuid>",
  "email": "admin@ticketera.com",
  "login_alias": "superadmin"
}
```

### 5. Verificar

Loguearte en el panel super-admin con:
- **email**: `admin@ticketera.com`
- **password**: el que pusiste en `SUPERADMIN_PASSWORD`

---

## Flujo de cambios de schema (después del setup)

```bash
# 1. Editá prisma/schema.prisma
# 2. Generá una nueva migration:
cd backend
npx prisma migrate dev --name <descripcion-corta> --schema=../prisma/schema.prisma
# Esto crea prisma/migrations/<timestamp>_<descripcion>/migration.sql

# 3. Aplicar en producción:
npx prisma migrate deploy --schema=../prisma/schema.prisma

# 4. Regenerar el client en ambos apps:
cd backend && npx prisma generate --schema=../prisma/schema.prisma
cd ../platea && npx prisma generate --schema=../prisma/schema.prisma
```

---

## Updated_at triggers

Por la decisión del design, las columnas `updated_at` NO se auto-updatean vía Prisma — usan **trigger de Postgres**. La primera migration crea:

- Función `set_updated_at()` (genérica)
- Trigger `BEFORE UPDATE` en cada tabla con `updated_at`

Si agregás una tabla nueva con `updated_at` en `schema.prisma`, **acordate de agregar el trigger** en una migration manual:

```sql
CREATE TRIGGER trg_set_updated_at_<tabla>
BEFORE UPDATE ON <tabla>
FOR EACH ROW EXECUTE FUNCTION set_updated_at();
```

---

## Troubleshooting

### "Can't reach database server"

Verificá:
- `DATABASE_URL` para queries normales (port 6543)
- `DIRECT_URL` para `migrate deploy` (port 5432)
- IPs de tu cliente whitelisted en Supabase (Settings → Database → Network restrictions)

### "prepared statement does not exist"

Pasa cuando usás el pooler en transaction mode con prepared statements. Solución: agregá `?pgbouncer=true` a `DATABASE_URL`.

### "advisory lock not held"

Estás corriendo advisory locks contra el pooler. Cambiá a `prismaDirectUrl`.

### "P2034 — Serialization failure"

Conflict de transacción Serializable. El backend tiene un wrapper `withRetry` que retryea hasta 3 veces con backoff. Si seguís viendo, hay contención muy alta — revisar concurrency del checkout.

---

## Referencias

- Design completo: `openspec/changes/migrate-to-postgres-prisma/design.md`
- Tasks de implementación: `openspec/changes/migrate-to-postgres-prisma/tasks.md`
- Specs delta: `openspec/changes/migrate-to-postgres-prisma/specs/`
- Supabase docs: https://supabase.com/docs/guides/database/connecting-to-postgres
- Prisma docs: https://www.prisma.io/docs
