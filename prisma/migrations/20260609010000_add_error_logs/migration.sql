-- CreateTable
CREATE TABLE "error_logs" (
    "id" SERIAL NOT NULL,
    "fingerprint" VARCHAR(64) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "severity" VARCHAR(20) NOT NULL,
    "message" TEXT NOT NULL,
    "stack" TEXT,
    "context" JSONB,
    "user_agent" VARCHAR(500),
    "ip_address" VARCHAR(45),
    "count_total" INTEGER NOT NULL DEFAULT 1,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolved_at" TIMESTAMPTZ,
    "resolved_by" VARCHAR(36),

    CONSTRAINT "error_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "error_logs_fingerprint_key" ON "error_logs"("fingerprint");

-- CreateIndex
CREATE INDEX "error_logs_last_seen_at_idx" ON "error_logs"("last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "error_logs_source_last_seen_at_idx" ON "error_logs"("source", "last_seen_at" DESC);

-- CreateIndex
CREATE INDEX "error_logs_resolved_at_last_seen_at_idx" ON "error_logs"("resolved_at", "last_seen_at" DESC);
