-- Agrega el campo favicon_url separado del logo_url.
-- El logo_url se usa en el navbar (suele ser horizontal/lockup).
-- El favicon_url se usa en la pestaña del navegador y en bookmarks (debe ser cuadrado, chico).
-- Si la empresa no sube favicon, el tenant cae al logo_url como fallback.
-- ADD COLUMN IF NOT EXISTS es idempotente — safe para re-run.

ALTER TABLE empresas ADD COLUMN IF NOT EXISTS favicon_url TEXT;
