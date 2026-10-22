-- login_tokens.id guarda sha256(token) en hex = 64 chars, pero la columna era
-- VARCHAR(36) (tamaño UUID). En MySQL truncaba silencioso; en Postgres rompe el
-- INSERT ("value too long for type character varying(36)") → el login por token
-- de comprador (y el "ingresar como comprador" desde el dashboard) quedaba caído.
-- Ensanchar es no-destructivo (los valores existentes ≤36 entran en 64).
ALTER TABLE "login_tokens" ALTER COLUMN "id" TYPE VARCHAR(64);
