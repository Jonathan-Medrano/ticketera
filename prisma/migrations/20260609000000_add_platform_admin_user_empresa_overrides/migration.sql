-- CreateTable
CREATE TABLE "platform_admin_user_empresa_overrides" (
    "id" VARCHAR(36) NOT NULL,
    "platform_admin_user_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "flow" "PlatformFlowEnum" NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "configured_by_platform_admin_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_user_empresa_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_user_empresa_overrides_user_empresa_flow_key" ON "platform_admin_user_empresa_overrides"("platform_admin_user_id", "empresa_id", "flow");

-- CreateIndex
CREATE INDEX "platform_admin_user_empresa_overrides_empresa_flow_idx" ON "platform_admin_user_empresa_overrides"("empresa_id", "flow");

-- CreateIndex
CREATE INDEX "platform_admin_user_empresa_overrides_user_idx" ON "platform_admin_user_empresa_overrides"("platform_admin_user_id");
