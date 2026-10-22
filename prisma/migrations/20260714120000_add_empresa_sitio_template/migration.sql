-- CreateTable
CREATE TABLE "empresa_sitio_templates" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(60) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresa_sitio_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "empresa_sitio_templates_empresa_id_idx" ON "empresa_sitio_templates"("empresa_id");
