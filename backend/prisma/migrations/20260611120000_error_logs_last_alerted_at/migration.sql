-- Alertas de errores al super-admin: columna para el cooldown anti-spam.
-- Guarda la última vez que se despachó un email de alerta para este fingerprint,
-- para re-alertar un error recurrente como mucho una vez por ventana de cooldown.
-- Nullable, sin constraint -> safe, no bloquea el arranque del backend.

ALTER TABLE error_logs ADD COLUMN IF NOT EXISTS last_alerted_at timestamptz;
