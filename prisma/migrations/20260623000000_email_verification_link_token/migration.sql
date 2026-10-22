-- Token de magic-link para confirmar el email de un click, además del código de 6 dígitos.
-- Cada código activo lleva su token random (hasheado SHA256). El email de verificación
-- ofrece el código Y un botón que linkea a /verificar-email?token=... para confirmar sin tipear.
-- Nullable: códigos legacy sin token siguen funcionando vía el flujo de 6 dígitos.
ALTER TABLE "email_verification_codes" ADD COLUMN IF NOT EXISTS "link_token_hash" VARCHAR(64);

CREATE INDEX IF NOT EXISTS "email_verification_codes_link_token_hash_idx" ON "email_verification_codes" ("link_token_hash");
