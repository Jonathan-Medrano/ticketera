-- AlterTable
ALTER TABLE "empresas" ADD COLUMN     "vidriera_disabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "vidriera_disabled_at" TIMESTAMPTZ;
