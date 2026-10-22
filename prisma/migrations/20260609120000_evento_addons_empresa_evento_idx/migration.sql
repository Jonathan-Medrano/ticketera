-- Acelera el filtro IDOR (WHERE empresa_id = $1 AND evento_id = $2) usado por
-- updateAddon, deleteAddon y futuras queries scope-by-evento desde el admin.
-- Idempotente — safe para re-run en envs ya migrados.

CREATE INDEX IF NOT EXISTS evento_addons_empresa_evento_idx ON evento_addons (empresa_id, evento_id);
