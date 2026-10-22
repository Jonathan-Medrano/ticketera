-- Migracion PURAMENTE ADITIVA: solo CREATE TABLE / CREATE INDEX.
-- No altera, renombra ni borra ninguna tabla ni columna existente.
--
-- NOTA: `prisma migrate dev` genero ademas un
--   ALTER TABLE "empresa_sitio_templates" ALTER COLUMN "updated_at" DROP DEFAULT;
-- que fue REMOVIDO A PROPOSITO. Es drift preexistente, ajeno a este cambio:
-- esa columna tiene DEFAULT CURRENT_TIMESTAMP en la base y el schema declara
-- @updatedAt sin default. Los defaults/triggers de updated_at son
-- intencionales en este repo (ver comentarios "real updates via trigger").
-- Incluirlo aca romperia el plan de rollback de este change (que debe ser
-- "dropear 3 tablas") y mezclaria dos cambios sin relacion.
-- Corresponde resolverlo en su propio change de reconciliacion de schema.

-- CreateTable
CREATE TABLE "platform_fee_tiers" (
    "id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "min_entradas_90d" INTEGER NOT NULL,
    "pct_entradas" DECIMAL(5,2) NOT NULL,
    "pct_consumibles" DECIMAL(5,2) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_fee_tiers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_fee_tier_state" (
    "empresa_id" VARCHAR(36) NOT NULL,
    "current_tier_id" VARCHAR(36),
    "entradas_ventana" INTEGER NOT NULL DEFAULT 0,
    "evaluated_at" TIMESTAMPTZ,
    "pending_downgrade_tier_id" VARCHAR(36),
    "pending_desde" TIMESTAMPTZ,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "pinned_por" VARCHAR(36),
    "pinned_motivo" VARCHAR(200),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "empresa_fee_tier_state_pkey" PRIMARY KEY ("empresa_id")
);

-- CreateTable
CREATE TABLE "empresa_fee_tier_events" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "flow" VARCHAR(40) NOT NULL,
    "pct_anterior" DECIMAL(5,2),
    "pct_nuevo" DECIMAL(5,2) NOT NULL,
    "tier_id" VARCHAR(36),
    "tier_nombre" VARCHAR(60),
    "entradas_ventana" INTEGER NOT NULL,
    "origen" VARCHAR(20) NOT NULL,
    "aplicado_por" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_fee_tier_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_fee_tiers_activo_min_entradas_90d_idx" ON "platform_fee_tiers"("activo", "min_entradas_90d");

-- CreateIndex
CREATE UNIQUE INDEX "platform_fee_tiers_min_entradas_90d_key" ON "platform_fee_tiers"("min_entradas_90d");

-- CreateIndex
CREATE INDEX "empresa_fee_tier_state_pending_downgrade_tier_id_idx" ON "empresa_fee_tier_state"("pending_downgrade_tier_id");

-- CreateIndex
CREATE INDEX "empresa_fee_tier_state_pinned_idx" ON "empresa_fee_tier_state"("pinned");

-- CreateIndex
CREATE INDEX "empresa_fee_tier_events_empresa_id_created_at_idx" ON "empresa_fee_tier_events"("empresa_id", "created_at");

-- CreateIndex
CREATE INDEX "empresa_fee_tier_events_origen_idx" ON "empresa_fee_tier_events"("origen");
