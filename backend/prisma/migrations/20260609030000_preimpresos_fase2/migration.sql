-- Fase 2 de pre-impresos: flags de seguridad en el lote + asignación a revendedores.

-- AlterTable: ticket_fisico_lotes
ALTER TABLE "ticket_fisico_lotes"
  ADD COLUMN "seguridad_guilloche" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seguridad_microtexto" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "seguridad_holograma_area" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: ticket_fisicos
ALTER TABLE "ticket_fisicos"
  ADD COLUMN "asignado_a_revendedor_id" VARCHAR(36),
  ADD COLUMN "asignado_at" TIMESTAMPTZ,
  ADD COLUMN "asignado_by_user_id" VARCHAR(36);

-- CreateIndex
CREATE INDEX "ticket_fisicos_asignado_a_revendedor_id_estado_idx" ON "ticket_fisicos"("asignado_a_revendedor_id", "estado");
