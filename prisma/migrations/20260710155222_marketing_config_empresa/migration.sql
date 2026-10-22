-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "marketing_automatizaciones" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "marketing_carrito_ventana_max" INTEGER NOT NULL DEFAULT 120,
ADD COLUMN     "marketing_carrito_ventana_min" INTEGER NOT NULL DEFAULT 60;
