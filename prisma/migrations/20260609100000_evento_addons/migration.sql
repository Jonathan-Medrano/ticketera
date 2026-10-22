-- Add-ons del evento: parking, meet&greet, merch, etc.
-- Cada unidad vendida genera un QR único canjeable en puerta (mismo flow que entradas).
-- Stock decrement atómico igual que entradas. fee_billing_mode aplica también acá.

CREATE TABLE "evento_addons" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "stock_disponible" INTEGER NOT NULL DEFAULT 0,
    "max_por_compra" INTEGER NOT NULL DEFAULT 10,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "orden_visual" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evento_addons_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "evento_addons_evento_activo_orden_idx" ON "evento_addons"("evento_id", "activo", "orden_visual");
CREATE INDEX "evento_addons_empresa_idx" ON "evento_addons"("empresa_id");

CREATE TABLE "evento_addon_ventas" (
    "id" VARCHAR(36) NOT NULL,
    "addon_id" VARCHAR(36) NOT NULL,
    "comprador_id" VARCHAR(36) NOT NULL,
    "checkout_session_id" VARCHAR(80),
    "evento_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "qr_code" VARCHAR(191) NOT NULL,
    "clave_corta" VARCHAR(32) NOT NULL,
    "estado" VARCHAR(40) NOT NULL DEFAULT 'valida',
    "precio_pagado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "comision" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "mp_fee_amount" DECIMAL(10,2),
    "neto_empresa_amount" DECIMAL(10,2),
    "usada_at" TIMESTAMPTZ,
    "used_by_user_id" VARCHAR(64),
    "used_by_user_name" VARCHAR(191),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evento_addon_ventas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "evento_addon_ventas_qr_code_key" ON "evento_addon_ventas"("qr_code");
CREATE UNIQUE INDEX "evento_addon_ventas_clave_corta_key" ON "evento_addon_ventas"("clave_corta");
CREATE INDEX "evento_addon_ventas_addon_idx" ON "evento_addon_ventas"("addon_id");
CREATE INDEX "evento_addon_ventas_comprador_idx" ON "evento_addon_ventas"("comprador_id");
CREATE INDEX "evento_addon_ventas_evento_estado_idx" ON "evento_addon_ventas"("evento_id", "estado");
CREATE INDEX "evento_addon_ventas_empresa_estado_created_idx" ON "evento_addon_ventas"("empresa_id", "estado", "created_at");
CREATE INDEX "evento_addon_ventas_checkout_session_idx" ON "evento_addon_ventas"("checkout_session_id");
