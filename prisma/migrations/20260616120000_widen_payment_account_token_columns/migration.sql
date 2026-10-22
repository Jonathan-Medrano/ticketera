-- Widen Mercado Pago OAuth token columns from tight VARCHAR limits to TEXT.
-- Root cause: MP returns access/refresh tokens (stored AES-GCM-encrypted + base64)
-- and scope strings whose length is provider-controlled and exceeded the VARCHAR
-- limits, making empresaPaymentAccount.upsert() fail with P2000 ("value too long
-- for the column's type") on OAuth connect. VARCHAR(n) -> TEXT in Postgres is a
-- metadata-only change (no table rewrite, no row scan), so it is safe to apply on
-- prod tables with existing data and will not block the migrate-deploy startup CMD.

ALTER TABLE "empresa_payment_accounts"
  ALTER COLUMN "credential_ciphertext" SET DATA TYPE TEXT,
  ALTER COLUMN "oauth_refresh_ciphertext" SET DATA TYPE TEXT,
  ALTER COLUMN "oauth_scope" SET DATA TYPE TEXT;

ALTER TABLE "platform_payment_accounts"
  ALTER COLUMN "credential_ciphertext" SET DATA TYPE TEXT,
  ALTER COLUMN "oauth_refresh_ciphertext" SET DATA TYPE TEXT,
  ALTER COLUMN "oauth_scope" SET DATA TYPE TEXT;
