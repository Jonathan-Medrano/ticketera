-- Telemetría del asistente Victoria: feedback del browser → backend (fire-and-forget).
-- Append-only. PRIVACIDAD: sin user_id, sin IP, sin email — sólo empresa_id de la sesión.
--   tipo='fallback' → query_text = texto buscado sin respuesta (cap 200, control-chars stripeados en app); topic_id/voto NULL.
--   tipo='voto'     → topic_id + voto ('up'|'down'); query_text NULL.
-- Idempotente y aditiva — segura de aplicar en prod vía `prisma migrate deploy`.
-- Sin FK a "empresas": convención del schema (relation-less; ninguna tabla declara FK a empresas).

CREATE TABLE IF NOT EXISTS "victoria_telemetria" (
    "id" BIGSERIAL NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "tipo" VARCHAR(20) NOT NULL,
    "query_text" VARCHAR(200),
    "topic_id" VARCHAR(100),
    "voto" VARCHAR(10),
    "ruta" VARCHAR(200),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "victoria_telemetria_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "victoria_telemetria_empresa_id_created_at_idx" ON "victoria_telemetria" ("empresa_id", "created_at");
CREATE INDEX IF NOT EXISTS "victoria_telemetria_tipo_created_at_idx" ON "victoria_telemetria" ("tipo", "created_at");
