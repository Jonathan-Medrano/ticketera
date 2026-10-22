-- Drop the marketing "referidos" (refer-a-friend) feature.
-- Decision: the feature was never completed (benefit never applied) and is being removed entirely.
-- Prod DB is empty (no clients), so dropping is safe. Idempotent so a re-run / restart never fails.
-- NOTE: this does NOT touch the revendedor feature (checkout_sessions.revendedor_id / ?ref= -> usuarios).

DROP TABLE IF EXISTS "referidos";
DROP TABLE IF EXISTS "referidos_programa";

-- Enums that were used exclusively by the referidos models.
DROP TYPE IF EXISTS "EstadoReferidoEnum";
DROP TYPE IF EXISTS "BeneficioTipoEnum";
