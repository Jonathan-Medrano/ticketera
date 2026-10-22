-- CreateTable
CREATE TABLE "ticket_fisico_lotes" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "categoria_id" VARCHAR(36) NOT NULL,
    "fecha_id" VARCHAR(36),
    "cantidad_total" INTEGER NOT NULL,
    "precio_impreso" DECIMAL(10,2),
    "formato" VARCHAR(40) NOT NULL DEFAULT 'horizontal_4xa4',
    "estado" VARCHAR(40) NOT NULL DEFAULT 'generado',
    "notas" TEXT,
    "fecha_envio_imprenta" TIMESTAMPTZ,
    "fecha_recepcion" TIMESTAMPTZ,
    "created_by_user_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_fisico_lotes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ticket_fisico_lotes_empresa_id_evento_id_idx" ON "ticket_fisico_lotes"("empresa_id", "evento_id");
CREATE INDEX "ticket_fisico_lotes_evento_id_categoria_id_idx" ON "ticket_fisico_lotes"("evento_id", "categoria_id");
CREATE INDEX "ticket_fisico_lotes_empresa_id_estado_idx" ON "ticket_fisico_lotes"("empresa_id", "estado");

-- CreateTable
CREATE TABLE "ticket_fisicos" (
    "id" VARCHAR(36) NOT NULL,
    "lote_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "categoria_id" VARCHAR(36) NOT NULL,
    "fecha_id" VARCHAR(36),
    "numero_secuencia" INTEGER NOT NULL,
    "qr_code" VARCHAR(191) NOT NULL,
    "clave_corta" VARCHAR(32) NOT NULL,
    "estado" VARCHAR(40) NOT NULL DEFAULT 'disponible',
    "vendido_at" TIMESTAMPTZ,
    "vendido_by_user_id" VARCHAR(64),
    "vendido_by_revendedor_id" VARCHAR(36),
    "precio_vendido" DECIMAL(10,2),
    "comprador_nombre" VARCHAR(191),
    "comprador_dni" VARCHAR(64),
    "usada_at" TIMESTAMPTZ,
    "used_by_user_id" VARCHAR(64),
    "used_by_user_name" VARCHAR(191),
    "anulada_at" TIMESTAMPTZ,
    "anulada_motivo" VARCHAR(191),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ticket_fisicos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ticket_fisicos_qr_code_key" ON "ticket_fisicos"("qr_code");
CREATE UNIQUE INDEX "ticket_fisicos_clave_corta_key" ON "ticket_fisicos"("clave_corta");
CREATE UNIQUE INDEX "ticket_fisicos_lote_id_numero_secuencia_key" ON "ticket_fisicos"("lote_id", "numero_secuencia");
CREATE INDEX "ticket_fisicos_evento_id_estado_idx" ON "ticket_fisicos"("evento_id", "estado");
CREATE INDEX "ticket_fisicos_categoria_id_estado_idx" ON "ticket_fisicos"("categoria_id", "estado");
CREATE INDEX "ticket_fisicos_empresa_id_estado_idx" ON "ticket_fisicos"("empresa_id", "estado");
CREATE INDEX "ticket_fisicos_lote_id_idx" ON "ticket_fisicos"("lote_id");
CREATE INDEX "ticket_fisicos_vendido_by_revendedor_id_idx" ON "ticket_fisicos"("vendido_by_revendedor_id");
