-- Reconcile schema drift between backend/prisma/schema.prisma and the migration history.
--
-- Context: production was partially built with `prisma db push`, so several objects
-- declared in schema.prisma were applied to prod OUTSIDE the migration history. A DB
-- built only from `prisma migrate deploy` was therefore missing columns the generated
-- Prisma client expects (P2022). This migration adds the missing objects.
--
-- HARD REQUIREMENTS for this file:
--   * IDEMPOTENT + prod-safe: every statement is a no-op when the object already exists,
--     so it can run on prod (objects present) AND on a fresh DB (objects absent).
--   * NON-DESTRUCTIVE: no DROP COLUMN / DROP TABLE / type narrowing. Index DROPs that the
--     diff suggested are intentionally NOT performed here (see the reconcile report) because
--     they remove live prod indexes that serve search / POS-report queries and that Prisma
--     simply cannot represent in schema.prisma (GIN/trgm + partial indexes).

-- Fail fast instead of hanging the deploy: the ADD COLUMN below takes an ACCESS EXCLUSIVE
-- lock on `compradores` (read by login/checkout). If a long-running txn holds the table at
-- deploy time, bail out cleanly rather than blocking new queries. Scoped to this migration's
-- transaction (SET LOCAL), so it does not leak to the rest of the session.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '60s';

-- ─────────────────────────────────────────────────────────────────────────────
-- compradores: temporary-password fields
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "compradores" ADD COLUMN IF NOT EXISTS "must_change_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "compradores" ADD COLUMN IF NOT EXISTS "temporary_password_set_at" TIMESTAMPTZ;

-- ─────────────────────────────────────────────────────────────────────────────
-- evento_tandas: activation window + ordering
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "evento_tandas" ADD COLUMN IF NOT EXISTS "activa_desde" TIMESTAMPTZ;
ALTER TABLE "evento_tandas" ADD COLUMN IF NOT EXISTS "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "evento_tandas" ADD COLUMN IF NOT EXISTS "orden" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS "evento_tandas_evento_id_orden_idx" ON "evento_tandas"("evento_id", "orden");

-- ─────────────────────────────────────────────────────────────────────────────
-- Drop DB-level DEFAULT on @updatedAt columns (app/trigger-managed in schema.prisma).
-- ALTER COLUMN ... DROP DEFAULT is a no-op (no error) when there is no default → idempotent.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE "evento_addons" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "platform_admin_user_empresa_overrides" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "platform_settings" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ticket_fisico_lotes" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "ticket_fisicos" ALTER COLUMN "updated_at" DROP DEFAULT;
ALTER TABLE "waitlist_entries" ALTER COLUMN "updated_at" DROP DEFAULT;

-- ─────────────────────────────────────────────────────────────────────────────
-- Index renames: align migration-era index names with the names Prisma auto-derives
-- from schema.prisma. Fully idempotent: each rename runs only when the old name exists
-- and the new name does not, so it is a no-op on a DB that already carries the new names
-- (e.g. prod tables created via `db push`) and applies cleanly on a fresh migrated DB.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('evento_addon_ventas_addon_idx',                            'evento_addon_ventas_addon_id_idx'),
      ('evento_addon_ventas_checkout_session_idx',                 'evento_addon_ventas_checkout_session_id_idx'),
      ('evento_addon_ventas_comprador_idx',                        'evento_addon_ventas_comprador_id_idx'),
      ('evento_addon_ventas_empresa_estado_created_idx',           'evento_addon_ventas_empresa_id_estado_created_at_idx'),
      ('evento_addon_ventas_evento_estado_idx',                    'evento_addon_ventas_evento_id_estado_idx'),
      ('evento_addons_empresa_evento_idx',                         'evento_addons_empresa_id_evento_id_idx'),
      ('evento_addons_empresa_idx',                                'evento_addons_empresa_id_idx'),
      ('evento_addons_evento_activo_orden_idx',                    'evento_addons_evento_id_activo_orden_visual_idx'),
      ('platform_admin_user_empresa_overrides_empresa_flow_idx',   'platform_admin_user_empresa_overrides_empresa_id_flow_idx'),
      ('platform_admin_user_empresa_overrides_user_empresa_flow_key', 'platform_admin_user_empresa_overrides_platform_admin_user_i_key'),
      ('platform_admin_user_empresa_overrides_user_idx',           'platform_admin_user_empresa_overrides_platform_admin_user_i_idx'),
      ('waitlist_entries_categoria_estado_created_idx',            'waitlist_entries_categoria_id_estado_created_at_idx'),
      ('waitlist_entries_comprador_estado_idx',                    'waitlist_entries_comprador_id_estado_idx'),
      ('waitlist_entries_empresa_evento_categoria_estado_idx',     'waitlist_entries_empresa_id_evento_id_categoria_id_estado_idx')
    ) AS t(old_name, new_name)
  LOOP
    IF EXISTS (SELECT 1 FROM pg_class WHERE relname = r.old_name AND relkind = 'i')
       AND NOT EXISTS (SELECT 1 FROM pg_class WHERE relname = r.new_name AND relkind = 'i') THEN
      EXECUTE format('ALTER INDEX %I RENAME TO %I', r.old_name, r.new_name);
    END IF;
  END LOOP;
END $$;
