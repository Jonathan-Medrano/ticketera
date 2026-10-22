-- AlterTable
-- Gate de la vidriera cross-tenant. Latch: se enciende una sola vez (2+ empresas
-- elegibles con eventos listados) y NO se apaga aunque el conteo baje, para no
-- romper el SEO ni los links ya compartidos de /eventos.
ALTER TABLE "platform_settings" ADD COLUMN     "vidriera_habilitada" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "platform_settings" ADD COLUMN     "vidriera_habilitada_at" TIMESTAMPTZ;
