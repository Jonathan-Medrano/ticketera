-- Seed de la escalera de comisiones por volumen.
--
-- IMPORTANTE: los tres tiers se insertan con activo = FALSE.
-- La feature se despliega APAGADA. La escalera se activa a mano desde
-- super-admin recien despues de verificar en produccion que los conteos de
-- volumen son correctos y de que los T&C declaren el esquema de tiers.
-- Mientras activo = FALSE, el job corre pero no resuelve ningun tier y no
-- modifica ninguna comision.
--
-- Idempotente: ON CONFLICT DO NOTHING sobre el unique de min_entradas_90d,
-- asi re-aplicar la migracion nunca pisa valores que el dueño haya tuneado
-- desde el panel.

INSERT INTO "platform_fee_tiers"
  ("id", "nombre", "min_entradas_90d", "pct_entradas", "pct_consumibles", "activo", "orden", "created_at", "updated_at")
VALUES
  ('fee-tier-base',  'Base',          0,    4.00, 3.00, FALSE, 0, NOW(), NOW()),
  ('fee-tier-pro',   'Pro',           2000, 3.50, 2.50, FALSE, 1, NOW(), NOW()),
  ('fee-tier-alto',  'Alto volumen',  6000, 3.00, 2.00, FALSE, 2, NOW(), NOW())
ON CONFLICT ("min_entradas_90d") DO NOTHING;
