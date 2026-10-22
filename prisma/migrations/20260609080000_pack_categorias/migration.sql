-- Pack model en categorías: una categoría puede ser un "pack" que genera N QRs por unidad comprada.
-- entradas_por_unidad=1 (default): comportamiento normal (1 unidad = 1 QR).
-- entradas_por_unidad=2: pack 2x1 (1 unidad comprada = 2 QRs).
-- Stock se cuenta en UNIDADES del pack, no en QRs individuales.

ALTER TABLE "entrada_categorias"
  ADD COLUMN "entradas_por_unidad" INTEGER NOT NULL DEFAULT 1;
