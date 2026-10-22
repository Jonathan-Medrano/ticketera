-- AlterTable
ALTER TABLE "entradas" ADD COLUMN     "asiento_id" VARCHAR(36);

-- AlterTable
ALTER TABLE "eventos" ADD COLUMN     "tipo_mapa" VARCHAR(20) NOT NULL DEFAULT 'libre';

-- CreateTable
CREATE TABLE "asiento_secciones" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "categoria_id" VARCHAR(36),
    "filas" INTEGER NOT NULL DEFAULT 1,
    "asientos_por_fila" INTEGER NOT NULL DEFAULT 1,
    "color" VARCHAR(20),
    "orden" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asiento_secciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asientos" (
    "id" VARCHAR(36) NOT NULL,
    "seccion_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "fila" VARCHAR(10) NOT NULL,
    "numero" INTEGER NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'disponible',
    "checkout_session_id" VARCHAR(36),
    "reserved_until" TIMESTAMPTZ,
    "entrada_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "asientos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "asiento_secciones_evento_id_idx" ON "asiento_secciones"("evento_id");

-- CreateIndex
CREATE INDEX "asiento_secciones_empresa_id_idx" ON "asiento_secciones"("empresa_id");

-- CreateIndex
CREATE INDEX "asientos_evento_id_idx" ON "asientos"("evento_id");

-- CreateIndex
CREATE INDEX "asientos_evento_id_estado_idx" ON "asientos"("evento_id", "estado");

-- CreateIndex
CREATE INDEX "asientos_checkout_session_id_idx" ON "asientos"("checkout_session_id");

-- CreateIndex
CREATE INDEX "asientos_entrada_id_idx" ON "asientos"("entrada_id");

-- CreateIndex
CREATE UNIQUE INDEX "asientos_seccion_id_fila_numero_key" ON "asientos"("seccion_id", "fila", "numero");

-- AddForeignKey
ALTER TABLE "asientos" ADD CONSTRAINT "asientos_seccion_id_fkey" FOREIGN KEY ("seccion_id") REFERENCES "asiento_secciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
