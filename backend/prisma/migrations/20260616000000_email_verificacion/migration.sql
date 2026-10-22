-- Verificación de email por código de 6 dígitos para el registro público de empresas.
-- email_verificado default true grandfatherea empresas existentes; el registro
-- público lo setea false hasta que el usuario verifica con el código enviado.
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "email_verificado" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "empresas" ADD COLUMN IF NOT EXISTS "email_verificado_at" TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS "email_verification_codes" (
  "id" VARCHAR(36) PRIMARY KEY,
  "empresa_id" VARCHAR(36) NOT NULL,
  "email" VARCHAR(191) NOT NULL,
  "code_hash" VARCHAR(64) NOT NULL,
  "expires_at" TIMESTAMPTZ NOT NULL,
  "consumed_at" TIMESTAMPTZ,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "requested_ip" VARCHAR(64),
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "email_verification_codes_empresa_id_idx" ON "email_verification_codes" ("empresa_id");
