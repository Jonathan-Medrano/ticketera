-- DropIndex
DROP INDEX "idx_consumibles_descripcion_trgm";

-- DropIndex
DROP INDEX "idx_consumibles_nombre_trgm";

-- DropIndex
DROP INDEX "entradas_vendido_by_user_id_created_at_idx";

-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "font" VARCHAR(50);
