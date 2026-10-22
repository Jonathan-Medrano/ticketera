-- Waitlist: lista de espera cuando una categoría está agotada.
-- Cuando se libera cupo (refund, expiración de checkout reservado, stock manual),
-- el job de checkoutCleanup asigna al primer entry en 'esperando' y le da 15 min para comprar.

CREATE TABLE "waitlist_entries" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "categoria_id" VARCHAR(36) NOT NULL,
    "fecha_id" VARCHAR(36),
    "comprador_id" VARCHAR(36) NOT NULL,
    "cantidad_solicitada" INTEGER NOT NULL DEFAULT 1,
    "estado" VARCHAR(40) NOT NULL DEFAULT 'esperando',
    "asignado_at" TIMESTAMPTZ,
    "expires_at" TIMESTAMPTZ,
    "notificado_at" TIMESTAMPTZ,
    "cancelado_at" TIMESTAMPTZ,
    "comprado_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "waitlist_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "waitlist_entries_empresa_evento_categoria_estado_idx" ON "waitlist_entries" ("empresa_id", "evento_id", "categoria_id", "estado");
CREATE INDEX "waitlist_entries_comprador_estado_idx" ON "waitlist_entries" ("comprador_id", "estado");
CREATE INDEX "waitlist_entries_categoria_estado_created_idx" ON "waitlist_entries" ("categoria_id", "estado", "created_at");
CREATE INDEX "waitlist_entries_expires_at_idx" ON "waitlist_entries" ("expires_at");
