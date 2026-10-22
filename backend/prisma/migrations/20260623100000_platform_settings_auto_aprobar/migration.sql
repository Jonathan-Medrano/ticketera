-- Tabla singleton de configuración global de la plataforma.
-- Hoy controla la auto-aprobación de empresas en el registro público:
-- si auto_aprobar_empresas = true, las empresas nuevas quedan aprobadas sin
-- intervención del superadmin. Idempotente para no romper el arranque del
-- contenedor (CMD corre `prisma migrate deploy`).
CREATE TABLE IF NOT EXISTS "platform_settings" (
  "id" VARCHAR(36) NOT NULL,
  "auto_aprobar_empresas" BOOLEAN NOT NULL DEFAULT false,
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_by" VARCHAR(36),
  CONSTRAINT "platform_settings_pkey" PRIMARY KEY ("id")
);

-- Semilla de la fila singleton con defaults (auto-aprobación apagada).
INSERT INTO "platform_settings" ("id", "auto_aprobar_empresas")
VALUES ('singleton', false)
ON CONFLICT ("id") DO NOTHING;
