-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('mercadopago');

-- CreateEnum
CREATE TYPE "PaymentAccountStatus" AS ENUM ('pending_validation', 'ready_to_sell', 'blocked');

-- CreateEnum
CREATE TYPE "PaymentAccountReason" AS ENUM ('credentials_invalid', 'provider_unreachable', 'provider_blocked', 'manual_block', 'validation_pending');

-- CreateEnum
CREATE TYPE "ModofechaEnum" AS ENUM ('unica', 'multiple', 'pase');

-- CreateEnum
CREATE TYPE "EstadoReferidoEnum" AS ENUM ('pendiente', 'convertido');

-- CreateEnum
CREATE TYPE "BeneficioTipoEnum" AS ENUM ('descuento_porcentaje', 'descuento_monto');

-- CreateEnum
CREATE TYPE "MarketingCampanaTipoEnum" AS ENUM ('manual', 'automatica');

-- CreateEnum
CREATE TYPE "MarketingCampanaEstadoEnum" AS ENUM ('borrador', 'enviando', 'enviada', 'pausada');

-- CreateEnum
CREATE TYPE "MarketingEnvioEstadoEnum" AS ENUM ('pendiente', 'enviado', 'abierto', 'clicked', 'bounced', 'spam', 'error');

-- CreateEnum
CREATE TYPE "MarketingSegmentoTipoEnum" AS ENUM ('manual');

-- CreateEnum
CREATE TYPE "MarketingCodigoTipoEnum" AS ENUM ('porcentaje', 'monto_fijo');

-- CreateEnum
CREATE TYPE "MarketingCodigoAplicaAEnum" AS ENUM ('todos', 'entradas', 'consumibles');

-- CreateEnum
CREATE TYPE "PlatformMessageTipoEnum" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "PlatformMessageTargetTypeEnum" AS ENUM ('all', 'empresa');

-- CreateEnum
CREATE TYPE "PlatformFlowEnum" AS ENUM ('entradas', 'consumibles');

-- CreateEnum
CREATE TYPE "PlatformSaleAllocSourceTypeEnum" AS ENUM ('entrada', 'consumible_venta');

-- CreateEnum
CREATE TYPE "PlatformSaleAllocEntryKindEnum" AS ENUM ('allocation', 'reversal');

-- CreateEnum
CREATE TYPE "ProcessedWebhookStatusEnum" AS ENUM ('processing', 'done', 'failed');

-- CreateTable
CREATE TABLE "empresas" (
    "id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "slug" VARCHAR(191) NOT NULL,
    "email" VARCHAR(191),
    "password" VARCHAR(255),
    "password_changed_at" TIMESTAMPTZ,
    "admin_nombre" VARCHAR(191),
    "admin_apellido" VARCHAR(191),
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "logo_url" TEXT,
    "navbar_size" VARCHAR(30),
    "navbar_color" VARCHAR(20),
    "color_primario" VARCHAR(20),
    "color_fondo" VARCHAR(20),
    "color_texto" VARCHAR(20),
    "eventos_layout" VARCHAR(30),
    "desktop_event_card_size" VARCHAR(30),
    "mobile_event_layout" VARCHAR(30),
    "mostrar_descripcion_home" BOOLEAN NOT NULL DEFAULT true,
    "mostrar_tanda_activa_home" BOOLEAN NOT NULL DEFAULT true,
    "mostrar_badge_stock_home" BOOLEAN NOT NULL DEFAULT true,
    "mostrar_fecha_home" BOOLEAN NOT NULL DEFAULT true,
    "mostrar_lugar_home" BOOLEAN NOT NULL DEFAULT true,
    "mostrar_precio_home" BOOLEAN NOT NULL DEFAULT true,
    "titulo_eventos_home" VARCHAR(191),
    "subtitulo_eventos_home" VARCHAR(191),
    "cta_eventos_home" VARCHAR(191),
    "banner_variant" VARCHAR(50),
    "descripcion" TEXT,
    "whatsapp" VARCHAR(50),
    "support_contact_email" VARCHAR(191),
    "banners" TEXT,
    "home_sections" TEXT,
    "info_pages" TEXT,
    "faqs" TEXT,
    "galeria_fotos" JSONB,
    "tenant_public_disabled" BOOLEAN NOT NULL DEFAULT false,
    "tenant_public_disabled_at" TIMESTAMPTZ,
    "suspendido" BOOLEAN NOT NULL DEFAULT false,
    "suspendido_at" TIMESTAMPTZ,
    "suspendido_motivo" VARCHAR(500),
    "email_marketing_from" VARCHAR(255),
    "email_marketing_from_name" VARCHAR(100),
    "email_marketing_habilitado" BOOLEAN NOT NULL DEFAULT false,
    "ga4_measurement_id" VARCHAR(50),
    "meta_pixel_id" VARCHAR(50),
    "gtm_container_id" VARCHAR(50),
    "buyer_event_refunds_enabled" BOOLEAN NOT NULL DEFAULT false,
    "buyer_auto_refunds_enabled" BOOLEAN NOT NULL DEFAULT false,
    "buyer_auto_refunds_scope" VARCHAR(20) NOT NULL DEFAULT 'todos',
    "revendedor_habilitado" BOOLEAN NOT NULL DEFAULT true,
    "consumibles_habilitado" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "comision_revendedor_default" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empresas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "usuarios" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL DEFAULT '',
    "apellido" VARCHAR(100) NOT NULL DEFAULT '',
    "email" VARCHAR(191) NOT NULL DEFAULT '',
    "password" VARCHAR(255) NOT NULL DEFAULT '',
    "password_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rol" VARCHAR(50) NOT NULL DEFAULT 'vendedor',
    "permisos" TEXT,
    "porcentaje_comision" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "temporary_password_set_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "roles" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "slug" VARCHAR(50) NOT NULL,
    "permisos" TEXT,
    "es_predefinido" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "compradores" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "apellido" VARCHAR(100),
    "email" VARCHAR(191) NOT NULL,
    "dni" VARCHAR(20),
    "telefono" VARCHAR(30),
    "password" VARCHAR(255),
    "password_changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "phone_e164" VARCHAR(32),
    "phone_verified_at" TIMESTAMPTZ,
    "phone_verification_provider" VARCHAR(40),
    "delivery_preference" VARCHAR(20) NOT NULL DEFAULT 'email',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "email_marketing_opt_out" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "compradores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "login_tokens" (
    "id" VARCHAR(36) NOT NULL,
    "comprador_id" VARCHAR(36) NOT NULL,
    "empresa_slug" VARCHAR(191) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "usado" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "login_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" VARCHAR(36) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "actor_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "tenant_slug" VARCHAR(191),
    "email" VARCHAR(191) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,
    "invalidated_at" TIMESTAMPTZ,
    "invalidation_reason" VARCHAR(40),
    "requested_ip" VARCHAR(64),
    "requested_user_agent" VARCHAR(500),
    "consumed_ip" VARCHAR(64),
    "consumed_user_agent" VARCHAR(500),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_users" (
    "id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "email" VARCHAR(191) NOT NULL,
    "login_alias" VARCHAR(80) NOT NULL,
    "password" VARCHAR(255) NOT NULL,
    "password_changed_at" TIMESTAMPTZ,
    "role_slug" VARCHAR(40) NOT NULL DEFAULT 'empleado',
    "permisos" TEXT,
    "singleton_key" VARCHAR(80),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "must_change_password" BOOLEAN NOT NULL DEFAULT false,
    "temporary_password_set_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_payment_accounts" (
    "id" VARCHAR(36) NOT NULL,
    "platform_admin_user_id" VARCHAR(36),
    "provider" "PaymentProvider" NOT NULL DEFAULT 'mercadopago',
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'pending_validation',
    "reason" "PaymentAccountReason" DEFAULT 'validation_pending',
    "credential_ciphertext" VARCHAR(512) NOT NULL,
    "credential_iv" VARCHAR(64) NOT NULL,
    "credential_tag" VARCHAR(64) NOT NULL,
    "credential_last4" VARCHAR(4),
    "oauth_refresh_ciphertext" VARCHAR(512),
    "oauth_refresh_iv" VARCHAR(64),
    "oauth_refresh_tag" VARCHAR(64),
    "oauth_token_type" VARCHAR(40),
    "oauth_scope" VARCHAR(120),
    "oauth_expires_at" TIMESTAMPTZ,
    "oauth_connected_at" TIMESTAMPTZ,
    "provider_account_label" VARCHAR(120),
    "collector_id" VARCHAR(64),
    "validated_at" TIMESTAMPTZ,
    "last_validation_error" VARCHAR(80),
    "blocked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_relationships" (
    "platform_admin_user_id" VARCHAR(36) NOT NULL,
    "parent_platform_admin_user_id" VARCHAR(36),
    "branch_root_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "depth_from_root" INTEGER NOT NULL DEFAULT 0,
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_relationships_pkey" PRIMARY KEY ("platform_admin_user_id")
);

-- CreateTable
CREATE TABLE "platform_admin_closure" (
    "ancestor_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "descendant_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "depth" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_admin_closure_pkey" PRIMARY KEY ("ancestor_platform_admin_user_id","descendant_platform_admin_user_id")
);

-- CreateTable
CREATE TABLE "platform_admin_capability_grants" (
    "id" VARCHAR(36) NOT NULL,
    "platform_admin_user_id" VARCHAR(36) NOT NULL,
    "capability_key" VARCHAR(120) NOT NULL,
    "granted_by_platform_admin_user_id" VARCHAR(36),
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_capability_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_revenue_grants" (
    "id" VARCHAR(36) NOT NULL,
    "parent_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "child_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "flow" "PlatformFlowEnum" NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "source" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_revenue_grants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_admin_migration_audit" (
    "audit_key" VARCHAR(120) NOT NULL,
    "status" VARCHAR(40) NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_migration_audit_pkey" PRIMARY KEY ("audit_key")
);

-- CreateTable
CREATE TABLE "platform_admin_user_flow_shares" (
    "id" VARCHAR(36) NOT NULL,
    "platform_admin_user_id" VARCHAR(36) NOT NULL,
    "flow" "PlatformFlowEnum" NOT NULL,
    "percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "configured_by_platform_admin_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_admin_user_flow_shares_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_sale_allocations" (
    "id" VARCHAR(36) NOT NULL,
    "source_type" "PlatformSaleAllocSourceTypeEnum" NOT NULL,
    "source_id" VARCHAR(36) NOT NULL,
    "checkout_session_id" VARCHAR(80),
    "empresa_id" VARCHAR(36) NOT NULL,
    "flow" "PlatformFlowEnum" NOT NULL,
    "currency" VARCHAR(12) NOT NULL DEFAULT 'ARS',
    "owner_fee_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allocated_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "allocation_percentage" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "entry_kind" "PlatformSaleAllocEntryKindEnum" NOT NULL DEFAULT 'allocation',
    "reversal_for_allocation_id" VARCHAR(36),
    "reversal_reason" VARCHAR(60),
    "reversal_reference_type" VARCHAR(40),
    "reversal_reference_id" VARCHAR(80),
    "configured_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "effective_platform_admin_user_id" VARCHAR(36) NOT NULL,
    "fallback_reason" VARCHAR(40) NOT NULL DEFAULT 'none',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_sale_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_marketplace_fee_defaults" (
    "id" VARCHAR(36) NOT NULL,
    "flow" VARCHAR(40) NOT NULL,
    "mode" VARCHAR(20),
    "percentage" DECIMAL(5,2),
    "fixed_amount" DECIMAL(10,2),
    "updated_by_platform_admin_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "platform_marketplace_fee_defaults_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_impersonation_tokens" (
    "id" VARCHAR(36) NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "created_by" VARCHAR(36) NOT NULL,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "used_at" TIMESTAMPTZ,

    CONSTRAINT "platform_impersonation_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_messages" (
    "id" VARCHAR(36) NOT NULL,
    "titulo" VARCHAR(191) NOT NULL,
    "cuerpo" TEXT NOT NULL,
    "tipo" "PlatformMessageTipoEnum" NOT NULL DEFAULT 'info',
    "target_type" "PlatformMessageTargetTypeEnum" NOT NULL DEFAULT 'all',
    "target_empresa_id" VARCHAR(36),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "expires_at" TIMESTAMPTZ,
    "created_by" VARCHAR(36) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "platform_message_dismissals" (
    "message_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "dismissed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "platform_message_dismissals_pkey" PRIMARY KEY ("message_id","empresa_id")
);

-- CreateTable
CREATE TABLE "eventos" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "descripcion" TEXT,
    "lugar" VARCHAR(191),
    "modo_fecha" "ModofechaEnum" NOT NULL DEFAULT 'unica',
    "imagen_url" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "publication_mode" VARCHAR(20) NOT NULL DEFAULT 'immediate',
    "pre_publish_visibility" VARCHAR(30) NOT NULL DEFAULT 'hidden',
    "publish_at_utc" TIMESTAMPTZ,
    "publish_timezone" VARCHAR(64),
    "published_live_at" TIMESTAMPTZ,
    "venta_consumibles_habilitada" BOOLEAN NOT NULL DEFAULT false,
    "buyer_event_refunds_enabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "eventos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_tandas" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191),
    "descripcion" TEXT,
    "imagen_url" TEXT,
    "estado" VARCHAR(40) NOT NULL DEFAULT 'activa',

    CONSTRAINT "evento_tandas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_fechas" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "fecha" TIMESTAMPTZ,

    CONSTRAINT "evento_fechas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entrada_categorias" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "tanda_id" VARCHAR(36),
    "nombre" VARCHAR(191) NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "stock" INTEGER NOT NULL DEFAULT 0,
    "stock_disponible" INTEGER NOT NULL DEFAULT 0,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "entrada_categorias_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_ventas_snapshot" (
    "id" SERIAL NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "fecha_snapshot" DATE NOT NULL,
    "vendidas_acumuladas" INTEGER NOT NULL DEFAULT 0,
    "capacidad_total_snapshot" INTEGER NOT NULL DEFAULT 0,
    "ingresos_neto_acumulado" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "evento_ventas_snapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evento_reviews" (
    "id" SERIAL NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "comprador_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "puntuacion" INTEGER NOT NULL,
    "comentario" TEXT,
    "visible" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "evento_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checkout_sessions" (
    "id" VARCHAR(80) NOT NULL,
    "comprador_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "datos" TEXT NOT NULL,
    "estado" VARCHAR(40) NOT NULL,
    "expires_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmed_at" TIMESTAMPTZ,
    "payment_id" VARCHAR(120),
    "payment_status" VARCHAR(40),
    "reconciliation_status" VARCHAR(40) NOT NULL DEFAULT 'none',
    "reconciliation_note" VARCHAR(120),
    "last_payment_checked_at" TIMESTAMPTZ,
    "codigo_descuento" VARCHAR(50),
    "descuento_monto" DECIMAL(10,2),
    "refund_status" VARCHAR(30),
    "refund_provider_id" VARCHAR(120),
    "refund_amount" DECIMAL(10,2),
    "refund_initiated_at" TIMESTAMPTZ,
    "refund_completed_at" TIMESTAMPTZ,
    "refund_initiated_by" VARCHAR(64),
    "refund_error" VARCHAR(500),
    "refund_idempotency_key" VARCHAR(64),
    "refund_reason" VARCHAR(500),
    "delivery_status" VARCHAR(30),
    "delivery_retry_count" INTEGER NOT NULL DEFAULT 0,
    "delivery_next_attempt_at" TIMESTAMPTZ,
    "delivery_last_error" VARCHAR(500),
    "delivery_completed_at" TIMESTAMPTZ,
    "utm_source" VARCHAR(100),
    "utm_medium" VARCHAR(100),
    "utm_campaign" VARCHAR(100),
    "revendedor_id" VARCHAR(36),

    CONSTRAINT "checkout_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_webhooks" (
    "id" SERIAL NOT NULL,
    "provider" VARCHAR(50) NOT NULL,
    "payment_id" VARCHAR(100) NOT NULL,
    "empresa_id" VARCHAR(36),
    "session_id" VARCHAR(100),
    "result" VARCHAR(50),
    "status" "ProcessedWebhookStatusEnum" NOT NULL DEFAULT 'done',
    "error_message" TEXT,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "processed_webhooks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "entradas" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "categoria_id" VARCHAR(36) NOT NULL,
    "fecha_id" VARCHAR(36),
    "comprador_id" VARCHAR(36) NOT NULL,
    "qr_code" VARCHAR(191) NOT NULL,
    "clave_corta" VARCHAR(32) NOT NULL,
    "estado" VARCHAR(40) NOT NULL,
    "precio_pagado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "comision" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "comision_revendedor" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "mp_fee_amount" DECIMAL(10,2),
    "neto_empresa_amount" DECIMAL(10,2),
    "nombre_comprador" VARCHAR(191),
    "apellido_comprador" VARCHAR(191),
    "dni_comprador" VARCHAR(64),
    "checkout_session_id" VARCHAR(80),
    "revendedor_id" VARCHAR(36),
    "usada_at" TIMESTAMPTZ,
    "used_by_user_id" VARCHAR(64),
    "used_by_user_name" VARCHAR(191),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "entradas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barras" (
    "id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "buyer_consumible_refunds_enabled" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ,

    CONSTRAINT "barras_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumibles" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(191) NOT NULL,
    "descripcion" TEXT,
    "precio" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "imagen_url" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "archived_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumibles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barra_stock" (
    "id" VARCHAR(36) NOT NULL,
    "barra_id" VARCHAR(36) NOT NULL,
    "consumible_id" VARCHAR(36) NOT NULL,
    "stock_inicial" INTEGER NOT NULL DEFAULT 0,
    "stock_actual" INTEGER NOT NULL DEFAULT 0,
    "precio_override" DECIMAL(10,2),
    "activo" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "barra_stock_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barra_stock_logs" (
    "id" VARCHAR(36) NOT NULL,
    "barra_stock_id" VARCHAR(36) NOT NULL,
    "barra_id" VARCHAR(36) NOT NULL,
    "consumible_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "tipo" VARCHAR(40) NOT NULL,
    "stock_anterior" INTEGER NOT NULL,
    "stock_nuevo" INTEGER NOT NULL,
    "usuario_id" VARCHAR(36),
    "nota" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barra_stock_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumibles_ventas" (
    "id" VARCHAR(36) NOT NULL,
    "barra_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "comprador_id" VARCHAR(36),
    "usuario_id" VARCHAR(36),
    "checkout_session_id" VARCHAR(80),
    "origen" VARCHAR(40) NOT NULL DEFAULT 'manual',
    "qr_code" VARCHAR(191) NOT NULL,
    "clave_corta" VARCHAR(32) NOT NULL,
    "total" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "descuento" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "promocion_id" VARCHAR(36),
    "estado" VARCHAR(30) NOT NULL DEFAULT 'pendiente',
    "canjeado_at" TIMESTAMPTZ,
    "owner_fee_amount" DECIMAL(10,2),
    "owner_fee_currency" VARCHAR(12),
    "owner_fee_mode" VARCHAR(20),
    "owner_fee_percentage" DECIMAL(5,2),
    "owner_fee_fixed_amount" DECIMAL(10,2),
    "mp_fee_amount" DECIMAL(10,2),
    "neto_empresa_amount" DECIMAL(10,2),
    "resuelto_at" TIMESTAMPTZ,
    "delivered_amount" DECIMAL(10,2),
    "refunded_amount" DECIMAL(10,2),
    "refund_case_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumibles_ventas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumibles_venta_items" (
    "id" VARCHAR(36) NOT NULL,
    "venta_id" VARCHAR(36) NOT NULL,
    "consumible_id" VARCHAR(36) NOT NULL,
    "nombre_snapshot" VARCHAR(191) NOT NULL,
    "precio_unitario" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "cantidad" INTEGER NOT NULL DEFAULT 0,
    "subtotal" DECIMAL(10,2) NOT NULL DEFAULT 0,

    CONSTRAINT "consumibles_venta_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumibles_venta_resolucion_items" (
    "id" VARCHAR(36) NOT NULL,
    "venta_id" VARCHAR(36) NOT NULL,
    "venta_item_id" VARCHAR(36) NOT NULL,
    "consumible_id" VARCHAR(36),
    "nombre_snapshot" VARCHAR(191) NOT NULL,
    "cantidad_total" INTEGER NOT NULL,
    "cantidad_entregada" INTEGER NOT NULL DEFAULT 0,
    "cantidad_reembolsada" INTEGER NOT NULL DEFAULT 0,
    "monto_entregado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "monto_reembolsado" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "resolution_reason" VARCHAR(60),
    "actor_id" VARCHAR(36) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "consumibles_venta_resolucion_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_manual_cases" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "checkout_session_id" VARCHAR(80) NOT NULL,
    "flow" VARCHAR(20) NOT NULL,
    "status" VARCHAR(60) NOT NULL,
    "payment_id" VARCHAR(120),
    "payment_status" VARCHAR(40),
    "reconciliation_status" VARCHAR(40),
    "requested_amount" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "currency" VARCHAR(12) NOT NULL DEFAULT 'ARS',
    "request_reason" VARCHAR(255) NOT NULL,
    "request_note" TEXT,
    "request_origin" VARCHAR(40) NOT NULL DEFAULT 'company_manual',
    "external_refund_reference" VARCHAR(191),
    "evidence_note" TEXT,
    "requester_actor_id" VARCHAR(36) NOT NULL,
    "requester_actor_type" VARCHAR(20) NOT NULL,
    "requester_buyer_id" VARCHAR(36),
    "requested_event_id" VARCHAR(36),
    "requested_entry_id" VARCHAR(36),
    "requested_sale_id" VARCHAR(36),
    "company_policy_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "event_policy_snapshot" BOOLEAN NOT NULL DEFAULT false,
    "created_by" VARCHAR(36) NOT NULL,
    "resolved_by" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "refund_manual_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_manual_case_items" (
    "id" VARCHAR(36) NOT NULL,
    "case_id" VARCHAR(36) NOT NULL,
    "target_type" VARCHAR(40) NOT NULL,
    "target_id" VARCHAR(36) NOT NULL,
    "target_status_before" VARCHAR(60),
    "target_status_after" VARCHAR(60),
    "eligibility" VARCHAR(40) NOT NULL DEFAULT 'elegible',
    "block_reason" VARCHAR(255),
    "amount_snapshot" DECIMAL(10,2),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_manual_case_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_manual_case_events" (
    "id" VARCHAR(36) NOT NULL,
    "case_id" VARCHAR(36) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "actor_id" VARCHAR(36) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "payload_json" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_manual_case_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_manual_case_consumible_items" (
    "id" VARCHAR(36) NOT NULL,
    "case_id" VARCHAR(36) NOT NULL,
    "venta_id" VARCHAR(36) NOT NULL,
    "venta_item_id" VARCHAR(36) NOT NULL,
    "consumible_id" VARCHAR(36),
    "nombre_snapshot" VARCHAR(191) NOT NULL,
    "quantity_original" INTEGER NOT NULL DEFAULT 0,
    "quantity_requested" INTEGER NOT NULL DEFAULT 0,
    "quantity_executed" INTEGER NOT NULL DEFAULT 0,
    "quantity_rejected" INTEGER NOT NULL DEFAULT 0,
    "unit_price_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "amount_snapshot" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "status" VARCHAR(40) NOT NULL DEFAULT 'requested',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "refund_manual_case_consumible_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refund_manual_case_consumible_item_events" (
    "id" VARCHAR(36) NOT NULL,
    "case_id" VARCHAR(36) NOT NULL,
    "consumible_case_item_id" VARCHAR(36) NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "actor_id" VARCHAR(36) NOT NULL,
    "actor_type" VARCHAR(20) NOT NULL,
    "payload_json" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refund_manual_case_consumible_item_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_payment_accounts" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'mercadopago',
    "status" "PaymentAccountStatus" NOT NULL DEFAULT 'pending_validation',
    "reason" "PaymentAccountReason" DEFAULT 'validation_pending',
    "credential_ciphertext" VARCHAR(512) NOT NULL,
    "credential_iv" VARCHAR(64) NOT NULL,
    "credential_tag" VARCHAR(64) NOT NULL,
    "credential_last4" VARCHAR(4),
    "oauth_refresh_ciphertext" VARCHAR(512),
    "oauth_refresh_iv" VARCHAR(64),
    "oauth_refresh_tag" VARCHAR(64),
    "oauth_token_type" VARCHAR(40),
    "oauth_scope" VARCHAR(120),
    "oauth_expires_at" TIMESTAMPTZ,
    "oauth_connected_at" TIMESTAMPTZ,
    "provider_account_label" VARCHAR(120),
    "validated_at" TIMESTAMPTZ,
    "last_validation_error" VARCHAR(80),
    "blocked_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "empresa_payment_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empresa_marketplace_fee_overrides" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "flow" VARCHAR(40) NOT NULL,
    "mode" VARCHAR(20),
    "percentage" DECIMAL(5,2),
    "fixed_amount" DECIMAL(10,2),
    "updated_by_platform_admin_id" VARCHAR(36),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "empresa_marketplace_fee_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_campanas" (
    "id" SERIAL NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(200) NOT NULL,
    "tipo" "MarketingCampanaTipoEnum" NOT NULL DEFAULT 'manual',
    "trigger_slug" VARCHAR(50),
    "asunto" VARCHAR(300) NOT NULL,
    "contenido_html" TEXT NOT NULL,
    "segmento_id" INTEGER,
    "evento_id" VARCHAR(36),
    "estado" "MarketingCampanaEstadoEnum" NOT NULL DEFAULT 'borrador',
    "programada_para" TIMESTAMPTZ,
    "enviada_at" TIMESTAMPTZ,
    "total_destinatarios" INTEGER NOT NULL DEFAULT 0,
    "total_enviados" INTEGER NOT NULL DEFAULT 0,
    "total_abiertos" INTEGER NOT NULL DEFAULT 0,
    "total_clicks" INTEGER NOT NULL DEFAULT 0,
    "total_bounces" INTEGER NOT NULL DEFAULT 0,
    "total_spam" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "marketing_campanas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_envios" (
    "id" SERIAL NOT NULL,
    "campana_id" INTEGER,
    "comprador_id" VARCHAR(36) NOT NULL,
    "checkout_session_id" VARCHAR(255),
    "resend_id" VARCHAR(255),
    "estado" "MarketingEnvioEstadoEnum" NOT NULL DEFAULT 'pendiente',
    "enviado_at" TIMESTAMPTZ,
    "abierto_at" TIMESTAMPTZ,
    "error_mensaje" VARCHAR(500),

    CONSTRAINT "marketing_envios_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_segmentos" (
    "id" SERIAL NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "descripcion" TEXT,
    "tipo" "MarketingSegmentoTipoEnum" NOT NULL DEFAULT 'manual',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_segmentos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_segmentos_compradores" (
    "segmento_id" INTEGER NOT NULL,
    "comprador_id" VARCHAR(36) NOT NULL,
    "agregado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_segmentos_compradores_pkey" PRIMARY KEY ("segmento_id","comprador_id")
);

-- CreateTable
CREATE TABLE "marketing_codigos_descuento" (
    "id" SERIAL NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "codigo" VARCHAR(50) NOT NULL,
    "tipo" "MarketingCodigoTipoEnum" NOT NULL DEFAULT 'porcentaje',
    "valor" DECIMAL(10,2) NOT NULL,
    "aplica_a" "MarketingCodigoAplicaAEnum" NOT NULL DEFAULT 'todos',
    "usos_maximos" INTEGER,
    "usos_actuales" INTEGER NOT NULL DEFAULT 0,
    "monto_minimo" DECIMAL(10,2),
    "valido_desde" TIMESTAMPTZ,
    "valido_hasta" TIMESTAMPTZ,
    "evento_id" VARCHAR(36),
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_codigos_descuento_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_codigos_descuento_usos" (
    "id" SERIAL NOT NULL,
    "codigo_id" INTEGER NOT NULL,
    "comprador_id" VARCHAR(36),
    "checkout_session_id" VARCHAR(255),
    "descuento_aplicado" DECIMAL(10,2) NOT NULL,
    "usado_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "marketing_codigos_descuento_usos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketing_oauth_accounts" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "provider" VARCHAR(20) NOT NULL DEFAULT 'google',
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "access_token_ciphertext" TEXT NOT NULL,
    "access_token_iv" VARCHAR(64) NOT NULL,
    "access_token_tag" VARCHAR(64) NOT NULL,
    "refresh_token_ciphertext" TEXT,
    "refresh_token_iv" VARCHAR(64),
    "refresh_token_tag" VARCHAR(64),
    "account_email" VARCHAR(191),
    "scopes" VARCHAR(500),
    "expires_at" TIMESTAMPTZ,
    "connected_at" TIMESTAMPTZ,
    "ga4_property_id" VARCHAR(100),
    "ga4_measurement_id" VARCHAR(50),
    "gtm_account_id" VARCHAR(50),
    "gtm_container_id" VARCHAR(50),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "marketing_oauth_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referidos_programa" (
    "id" SERIAL NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT false,
    "beneficio_referidor_tipo" "BeneficioTipoEnum" NOT NULL DEFAULT 'descuento_porcentaje',
    "beneficio_referidor_valor" DECIMAL(10,2) NOT NULL DEFAULT 10,
    "beneficio_referido_tipo" "BeneficioTipoEnum" NOT NULL DEFAULT 'descuento_porcentaje',
    "beneficio_referido_valor" DECIMAL(10,2) NOT NULL DEFAULT 5,

    CONSTRAINT "referidos_programa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referidos" (
    "id" SERIAL NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "referidor_id" VARCHAR(36) NOT NULL,
    "referido_id" VARCHAR(36),
    "codigo" VARCHAR(20) NOT NULL,
    "estado" "EstadoReferidoEnum" NOT NULL DEFAULT 'pendiente',
    "convertido_at" TIMESTAMPTZ,
    "beneficio_aplicado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referidos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumibles_canje_auditoria" (
    "id" VARCHAR(36) NOT NULL,
    "venta_id" VARCHAR(36),
    "empresa_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36),
    "barra_id" VARCHAR(36),
    "actor_id" VARCHAR(36),
    "actor_type" VARCHAR(20),
    "accion" VARCHAR(40) NOT NULL,
    "codigo_ingresado" VARCHAR(255),
    "motivo" VARCHAR(255),
    "detalle_json" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumibles_canje_auditoria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" SERIAL NOT NULL,
    "actor_id" VARCHAR(36),
    "actor_email" VARCHAR(255),
    "actor_label" VARCHAR(255),
    "actor_type" VARCHAR(50),
    "action" VARCHAR(100) NOT NULL,
    "entity_type" VARCHAR(50),
    "entity_id" VARCHAR(100),
    "entity_label" VARCHAR(255),
    "payload" JSONB,
    "ip_address" VARCHAR(45),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "barra_restock_alertas" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36) NOT NULL,
    "barra_id" VARCHAR(36) NOT NULL,
    "barra_stock_id" VARCHAR(36) NOT NULL,
    "consumible_id" VARCHAR(36) NOT NULL,
    "estado" VARCHAR(20) NOT NULL DEFAULT 'pendiente',
    "nota" TEXT,
    "requested_by_user_id" VARCHAR(36),
    "resolved_by_user_id" VARCHAR(36),
    "resolved_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "barra_restock_alertas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consumibles_promociones" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "evento_id" VARCHAR(36),
    "nombre" VARCHAR(120) NOT NULL,
    "descripcion" TEXT,
    "tipo" VARCHAR(30) NOT NULL,
    "valor" DECIMAL(10,2) NOT NULL,
    "consumible_ids" TEXT NOT NULL,
    "cantidad_minima" INTEGER NOT NULL DEFAULT 1,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "fecha_inicio" TIMESTAMPTZ,
    "fecha_fin" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "consumibles_promociones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "empleados_actividad" (
    "id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "empleado_id" VARCHAR(36) NOT NULL,
    "tipo" VARCHAR(50) NOT NULL,
    "descripcion" VARCHAR(500) NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "empleados_actividad_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_cleanup_runs" (
    "id" SERIAL NOT NULL,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ NOT NULL,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "scanned" INTEGER NOT NULL DEFAULT 0,
    "in_use" INTEGER NOT NULL DEFAULT 0,
    "within_cooldown" INTEGER NOT NULL DEFAULT 0,
    "orphans" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "cooldown_hours" INTEGER NOT NULL DEFAULT 24,
    "dry_run" BOOLEAN NOT NULL DEFAULT false,
    "triggered_by" VARCHAR(20) NOT NULL DEFAULT 'cron',
    "triggered_by_user_id" VARCHAR(64),
    "triggered_by_user_name" VARCHAR(191),
    "status" VARCHAR(20) NOT NULL DEFAULT 'ok',
    "reason" VARCHAR(120),
    "sample_paths" TEXT,

    CONSTRAINT "storage_cleanup_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "soporte_mensajes" (
    "id" SERIAL NOT NULL,
    "empresa_id" VARCHAR(64) NOT NULL,
    "nombre" VARCHAR(100) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "mensaje" TEXT NOT NULL,
    "email_enviado" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "soporte_mensajes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "buyer_phone_verification_challenges" (
    "id" VARCHAR(36) NOT NULL,
    "buyer_id" VARCHAR(36) NOT NULL,
    "empresa_id" VARCHAR(36) NOT NULL,
    "phone_e164" VARCHAR(32) NOT NULL,
    "provider" VARCHAR(40),
    "code_hash" VARCHAR(128) NOT NULL,
    "status" VARCHAR(30) NOT NULL DEFAULT 'pending',
    "attempts_count" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 5,
    "expires_at" TIMESTAMPTZ NOT NULL,
    "resend_available_at" TIMESTAMPTZ,
    "verified_at" TIMESTAMPTZ,
    "invalidated_at" TIMESTAMPTZ,
    "invalidation_reason" VARCHAR(60),
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "buyer_phone_verification_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_dispatch_attempts" (
    "id" VARCHAR(36) NOT NULL,
    "checkout_session_id" VARCHAR(80) NOT NULL,
    "buyer_id" VARCHAR(36),
    "empresa_id" VARCHAR(36) NOT NULL,
    "channel" VARCHAR(20) NOT NULL,
    "status" VARCHAR(30) NOT NULL,
    "provider" VARCHAR(40),
    "recipient" VARCHAR(191),
    "error_code" VARCHAR(60),
    "error_message" VARCHAR(255),
    "payload_json" TEXT,
    "dispatched_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "delivery_dispatch_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_limit_buckets" (
    "bucket_key" VARCHAR(191) NOT NULL,
    "hits" INTEGER NOT NULL,
    "reset_at_ms" BIGINT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "rate_limit_buckets_pkey" PRIMARY KEY ("bucket_key")
);

-- CreateTable
CREATE TABLE "landing_announcement" (
    "id" VARCHAR(36) NOT NULL,
    "content_html" TEXT NOT NULL,
    "cta_label" VARCHAR(120),
    "cta_href" VARCHAR(500),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "animation_mode" VARCHAR(32) NOT NULL DEFAULT 'static',
    "animation_speed" VARCHAR(16) NOT NULL DEFAULT 'normal',
    "background_color" VARCHAR(20),
    "updated_by" VARCHAR(36),
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "landing_announcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "empresas_slug_key" ON "empresas"("slug");

-- CreateIndex
CREATE INDEX "empresas_slug_idx" ON "empresas"("slug");

-- CreateIndex
CREATE INDEX "usuarios_empresa_id_idx" ON "usuarios"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "roles_empresa_id_slug_key" ON "roles"("empresa_id", "slug");

-- CreateIndex
CREATE INDEX "compradores_empresa_id_email_idx" ON "compradores"("empresa_id", "email");

-- CreateIndex
CREATE INDEX "compradores_email_idx" ON "compradores"("email");

-- CreateIndex
CREATE INDEX "compradores_dni_idx" ON "compradores"("dni");

-- CreateIndex
CREATE INDEX "login_tokens_comprador_id_idx" ON "login_tokens"("comprador_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_actor_type_actor_id_idx" ON "password_reset_tokens"("actor_type", "actor_id");

-- CreateIndex
CREATE INDEX "password_reset_tokens_token_hash_idx" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_users_email_key" ON "platform_admin_users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_users_login_alias_key" ON "platform_admin_users"("login_alias");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_users_singleton_key_key" ON "platform_admin_users"("singleton_key");

-- CreateIndex
CREATE INDEX "platform_payment_accounts_platform_admin_user_id_status_idx" ON "platform_payment_accounts"("platform_admin_user_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "platform_payment_accounts_platform_admin_user_id_provider_key" ON "platform_payment_accounts"("platform_admin_user_id", "provider");

-- CreateIndex
CREATE INDEX "platform_admin_relationships_parent_platform_admin_user_id_idx" ON "platform_admin_relationships"("parent_platform_admin_user_id");

-- CreateIndex
CREATE INDEX "platform_admin_relationships_branch_root_platform_admin_use_idx" ON "platform_admin_relationships"("branch_root_platform_admin_user_id");

-- CreateIndex
CREATE INDEX "platform_admin_closure_descendant_platform_admin_user_id_de_idx" ON "platform_admin_closure"("descendant_platform_admin_user_id", "depth");

-- CreateIndex
CREATE INDEX "platform_admin_capability_grants_granted_by_platform_admin__idx" ON "platform_admin_capability_grants"("granted_by_platform_admin_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_capability_grants_platform_admin_user_id_cap_key" ON "platform_admin_capability_grants"("platform_admin_user_id", "capability_key");

-- CreateIndex
CREATE INDEX "platform_admin_revenue_grants_child_platform_admin_user_id__idx" ON "platform_admin_revenue_grants"("child_platform_admin_user_id", "flow");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_revenue_grants_parent_platform_admin_user_id_key" ON "platform_admin_revenue_grants"("parent_platform_admin_user_id", "child_platform_admin_user_id", "flow");

-- CreateIndex
CREATE INDEX "platform_admin_user_flow_shares_flow_idx" ON "platform_admin_user_flow_shares"("flow");

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_user_flow_shares_platform_admin_user_id_flow_key" ON "platform_admin_user_flow_shares"("platform_admin_user_id", "flow");

-- CreateIndex
CREATE UNIQUE INDEX "platform_sale_allocations_reversal_for_allocation_id_key" ON "platform_sale_allocations"("reversal_for_allocation_id");

-- CreateIndex
CREATE INDEX "platform_sale_allocations_effective_platform_admin_user_id__idx" ON "platform_sale_allocations"("effective_platform_admin_user_id", "flow", "created_at");

-- CreateIndex
CREATE INDEX "platform_sale_allocations_configured_platform_admin_user_id_idx" ON "platform_sale_allocations"("configured_platform_admin_user_id", "flow", "created_at");

-- CreateIndex
CREATE INDEX "platform_sale_allocations_checkout_session_id_flow_idx" ON "platform_sale_allocations"("checkout_session_id", "flow");

-- CreateIndex
CREATE INDEX "platform_sale_allocations_source_type_source_id_idx" ON "platform_sale_allocations"("source_type", "source_id");

-- CreateIndex
CREATE INDEX "platform_sale_allocations_reversal_reference_type_reversal__idx" ON "platform_sale_allocations"("reversal_reference_type", "reversal_reference_id");

-- CreateIndex
CREATE INDEX "platform_sale_allocations_source_type_source_id_entry_kind__idx" ON "platform_sale_allocations"("source_type", "source_id", "entry_kind", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "platform_marketplace_fee_defaults_flow_key" ON "platform_marketplace_fee_defaults"("flow");

-- CreateIndex
CREATE UNIQUE INDEX "platform_impersonation_tokens_token_hash_key" ON "platform_impersonation_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "platform_impersonation_tokens_expires_at_idx" ON "platform_impersonation_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "platform_messages_target_type_target_empresa_id_idx" ON "platform_messages"("target_type", "target_empresa_id");

-- CreateIndex
CREATE INDEX "platform_messages_activo_idx" ON "platform_messages"("activo");

-- CreateIndex
CREATE INDEX "eventos_empresa_id_idx" ON "eventos"("empresa_id");

-- CreateIndex
CREATE INDEX "evento_tandas_evento_id_idx" ON "evento_tandas"("evento_id");

-- CreateIndex
CREATE INDEX "evento_tandas_evento_id_estado_idx" ON "evento_tandas"("evento_id", "estado");

-- CreateIndex
CREATE INDEX "evento_fechas_evento_id_idx" ON "evento_fechas"("evento_id");

-- CreateIndex
CREATE INDEX "evento_fechas_evento_id_fecha_idx" ON "evento_fechas"("evento_id", "fecha");

-- CreateIndex
CREATE INDEX "entrada_categorias_evento_id_idx" ON "entrada_categorias"("evento_id");

-- CreateIndex
CREATE INDEX "entrada_categorias_tanda_id_idx" ON "entrada_categorias"("tanda_id");

-- CreateIndex
CREATE INDEX "entrada_categorias_evento_id_nombre_idx" ON "entrada_categorias"("evento_id", "nombre");

-- CreateIndex
CREATE INDEX "evento_ventas_snapshot_evento_id_idx" ON "evento_ventas_snapshot"("evento_id");

-- CreateIndex
CREATE INDEX "evento_ventas_snapshot_fecha_snapshot_idx" ON "evento_ventas_snapshot"("fecha_snapshot");

-- CreateIndex
CREATE UNIQUE INDEX "evento_ventas_snapshot_evento_id_fecha_snapshot_key" ON "evento_ventas_snapshot"("evento_id", "fecha_snapshot");

-- CreateIndex
CREATE INDEX "evento_reviews_evento_id_idx" ON "evento_reviews"("evento_id");

-- CreateIndex
CREATE INDEX "evento_reviews_empresa_id_idx" ON "evento_reviews"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "evento_reviews_comprador_id_evento_id_key" ON "evento_reviews"("comprador_id", "evento_id");

-- CreateIndex
CREATE INDEX "checkout_sessions_comprador_id_empresa_id_estado_expires_at_idx" ON "checkout_sessions"("comprador_id", "empresa_id", "estado", "expires_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_empresa_id_estado_expires_at_idx" ON "checkout_sessions"("empresa_id", "estado", "expires_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_empresa_id_reconciliation_note_refund_sta_idx" ON "checkout_sessions"("empresa_id", "reconciliation_note", "refund_status");

-- CreateIndex
CREATE INDEX "checkout_sessions_estado_expires_at_idx" ON "checkout_sessions"("estado", "expires_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_delivery_status_delivery_next_attempt_at_idx" ON "checkout_sessions"("delivery_status", "delivery_next_attempt_at");

-- CreateIndex
CREATE INDEX "checkout_sessions_revendedor_id_idx" ON "checkout_sessions"("revendedor_id");

-- CreateIndex
CREATE INDEX "processed_webhooks_processed_at_idx" ON "processed_webhooks"("processed_at" DESC);

-- CreateIndex
CREATE INDEX "processed_webhooks_empresa_id_idx" ON "processed_webhooks"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "processed_webhooks_provider_payment_id_key" ON "processed_webhooks"("provider", "payment_id");

-- CreateIndex
CREATE UNIQUE INDEX "entradas_qr_code_key" ON "entradas"("qr_code");

-- CreateIndex
CREATE UNIQUE INDEX "entradas_clave_corta_key" ON "entradas"("clave_corta");

-- CreateIndex
CREATE INDEX "entradas_evento_id_idx" ON "entradas"("evento_id");

-- CreateIndex
CREATE INDEX "entradas_comprador_id_idx" ON "entradas"("comprador_id");

-- CreateIndex
CREATE INDEX "entradas_revendedor_id_idx" ON "entradas"("revendedor_id");

-- CreateIndex
CREATE INDEX "entradas_checkout_session_id_idx" ON "entradas"("checkout_session_id");

-- CreateIndex
CREATE INDEX "entradas_evento_id_estado_created_at_idx" ON "entradas"("evento_id", "estado", "created_at");

-- CreateIndex
CREATE INDEX "entradas_clave_corta_evento_id_idx" ON "entradas"("clave_corta", "evento_id");

-- CreateIndex
CREATE INDEX "entradas_evento_id_qr_code_idx" ON "entradas"("evento_id", "qr_code");

-- CreateIndex
CREATE INDEX "entradas_created_at_idx" ON "entradas"("created_at");

-- CreateIndex
CREATE INDEX "barras_evento_id_idx" ON "barras"("evento_id");

-- CreateIndex
CREATE INDEX "barras_empresa_id_idx" ON "barras"("empresa_id");

-- CreateIndex
CREATE INDEX "barras_evento_id_empresa_id_activa_idx" ON "barras"("evento_id", "empresa_id", "activa");

-- CreateIndex
CREATE INDEX "consumibles_empresa_id_idx" ON "consumibles"("empresa_id");

-- CreateIndex
CREATE INDEX "barra_stock_barra_id_consumible_id_idx" ON "barra_stock"("barra_id", "consumible_id");

-- CreateIndex
CREATE UNIQUE INDEX "barra_stock_barra_id_consumible_id_key" ON "barra_stock"("barra_id", "consumible_id");

-- CreateIndex
CREATE INDEX "barra_stock_logs_barra_stock_id_idx" ON "barra_stock_logs"("barra_stock_id");

-- CreateIndex
CREATE INDEX "barra_stock_logs_empresa_id_created_at_idx" ON "barra_stock_logs"("empresa_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "consumibles_ventas_qr_code_key" ON "consumibles_ventas"("qr_code");

-- CreateIndex
CREATE UNIQUE INDEX "consumibles_ventas_clave_corta_key" ON "consumibles_ventas"("clave_corta");

-- CreateIndex
CREATE INDEX "consumibles_ventas_checkout_session_id_idx" ON "consumibles_ventas"("checkout_session_id");

-- CreateIndex
CREATE INDEX "consumibles_ventas_comprador_id_idx" ON "consumibles_ventas"("comprador_id");

-- CreateIndex
CREATE INDEX "consumibles_ventas_empresa_id_evento_id_idx" ON "consumibles_ventas"("empresa_id", "evento_id");

-- CreateIndex
CREATE INDEX "consumibles_ventas_empresa_id_estado_created_at_idx" ON "consumibles_ventas"("empresa_id", "estado", "created_at");

-- CreateIndex
CREATE INDEX "consumibles_ventas_evento_id_idx" ON "consumibles_ventas"("evento_id");

-- CreateIndex
CREATE INDEX "consumibles_ventas_empresa_id_barra_id_qr_code_idx" ON "consumibles_ventas"("empresa_id", "barra_id", "qr_code");

-- CreateIndex
CREATE INDEX "consumibles_ventas_empresa_id_barra_id_clave_corta_idx" ON "consumibles_ventas"("empresa_id", "barra_id", "clave_corta");

-- CreateIndex
CREATE INDEX "consumibles_ventas_created_at_idx" ON "consumibles_ventas"("created_at");

-- CreateIndex
CREATE INDEX "consumibles_venta_items_venta_id_idx" ON "consumibles_venta_items"("venta_id");

-- CreateIndex
CREATE UNIQUE INDEX "consumibles_venta_resolucion_items_venta_item_id_key" ON "consumibles_venta_resolucion_items"("venta_item_id");

-- CreateIndex
CREATE INDEX "consumibles_venta_resolucion_items_venta_id_idx" ON "consumibles_venta_resolucion_items"("venta_id");

-- CreateIndex
CREATE INDEX "refund_manual_cases_checkout_session_id_idx" ON "refund_manual_cases"("checkout_session_id");

-- CreateIndex
CREATE INDEX "refund_manual_cases_empresa_id_status_idx" ON "refund_manual_cases"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "refund_manual_cases_requested_entry_id_status_idx" ON "refund_manual_cases"("requested_entry_id", "status");

-- CreateIndex
CREATE INDEX "refund_manual_cases_requested_sale_id_status_idx" ON "refund_manual_cases"("requested_sale_id", "status");

-- CreateIndex
CREATE INDEX "refund_manual_cases_created_at_idx" ON "refund_manual_cases"("created_at");

-- CreateIndex
CREATE INDEX "refund_manual_cases_empresa_id_requested_entry_id_created_a_idx" ON "refund_manual_cases"("empresa_id", "requested_entry_id", "created_at");

-- CreateIndex
CREATE INDEX "refund_manual_case_items_case_id_idx" ON "refund_manual_case_items"("case_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_items_target_type_target_id_idx" ON "refund_manual_case_items"("target_type", "target_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_events_case_id_idx" ON "refund_manual_case_events"("case_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_events_created_at_idx" ON "refund_manual_case_events"("created_at");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_items_case_id_idx" ON "refund_manual_case_consumible_items"("case_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_items_venta_id_idx" ON "refund_manual_case_consumible_items"("venta_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_items_venta_item_id_idx" ON "refund_manual_case_consumible_items"("venta_item_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_items_status_idx" ON "refund_manual_case_consumible_items"("status");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_items_venta_item_id_status_idx" ON "refund_manual_case_consumible_items"("venta_item_id", "status");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_item_events_case_id_idx" ON "refund_manual_case_consumible_item_events"("case_id");

-- CreateIndex
CREATE INDEX "refund_manual_case_consumible_item_events_consumible_case_i_idx" ON "refund_manual_case_consumible_item_events"("consumible_case_item_id");

-- CreateIndex
CREATE INDEX "empresa_payment_accounts_empresa_id_status_idx" ON "empresa_payment_accounts"("empresa_id", "status");

-- CreateIndex
CREATE INDEX "empresa_payment_accounts_provider_status_idx" ON "empresa_payment_accounts"("provider", "status");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_payment_accounts_empresa_id_provider_key" ON "empresa_payment_accounts"("empresa_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "empresa_marketplace_fee_overrides_empresa_id_flow_key" ON "empresa_marketplace_fee_overrides"("empresa_id", "flow");

-- CreateIndex
CREATE INDEX "marketing_campanas_empresa_id_idx" ON "marketing_campanas"("empresa_id");

-- CreateIndex
CREATE INDEX "marketing_campanas_estado_idx" ON "marketing_campanas"("estado");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_envios_checkout_session_id_key" ON "marketing_envios"("checkout_session_id");

-- CreateIndex
CREATE INDEX "marketing_envios_campana_id_idx" ON "marketing_envios"("campana_id");

-- CreateIndex
CREATE INDEX "marketing_envios_comprador_id_idx" ON "marketing_envios"("comprador_id");

-- CreateIndex
CREATE INDEX "marketing_envios_checkout_session_id_idx" ON "marketing_envios"("checkout_session_id");

-- CreateIndex
CREATE INDEX "marketing_envios_resend_id_idx" ON "marketing_envios"("resend_id");

-- CreateIndex
CREATE INDEX "marketing_segmentos_empresa_id_idx" ON "marketing_segmentos"("empresa_id");

-- CreateIndex
CREATE INDEX "marketing_segmentos_compradores_comprador_id_idx" ON "marketing_segmentos_compradores"("comprador_id");

-- CreateIndex
CREATE INDEX "marketing_codigos_descuento_empresa_id_idx" ON "marketing_codigos_descuento"("empresa_id");

-- CreateIndex
CREATE INDEX "marketing_codigos_descuento_evento_id_idx" ON "marketing_codigos_descuento"("evento_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_codigos_descuento_empresa_id_codigo_key" ON "marketing_codigos_descuento"("empresa_id", "codigo");

-- CreateIndex
CREATE INDEX "marketing_codigos_descuento_usos_codigo_id_idx" ON "marketing_codigos_descuento_usos"("codigo_id");

-- CreateIndex
CREATE INDEX "marketing_codigos_descuento_usos_checkout_session_id_idx" ON "marketing_codigos_descuento_usos"("checkout_session_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketing_oauth_accounts_empresa_id_provider_key" ON "marketing_oauth_accounts"("empresa_id", "provider");

-- CreateIndex
CREATE UNIQUE INDEX "referidos_programa_empresa_id_key" ON "referidos_programa"("empresa_id");

-- CreateIndex
CREATE UNIQUE INDEX "referidos_codigo_key" ON "referidos"("codigo");

-- CreateIndex
CREATE INDEX "referidos_empresa_id_idx" ON "referidos"("empresa_id");

-- CreateIndex
CREATE INDEX "consumibles_canje_auditoria_venta_id_idx" ON "consumibles_canje_auditoria"("venta_id");

-- CreateIndex
CREATE INDEX "consumibles_canje_auditoria_empresa_id_created_at_idx" ON "consumibles_canje_auditoria"("empresa_id", "created_at");

-- CreateIndex
CREATE INDEX "consumibles_canje_auditoria_empresa_id_accion_idx" ON "consumibles_canje_auditoria"("empresa_id", "accion");

-- CreateIndex
CREATE INDEX "audit_logs_created_at_idx" ON "audit_logs"("created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_idx" ON "audit_logs"("actor_id");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_entity_type_entity_id_idx" ON "audit_logs"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "barra_restock_alertas_barra_stock_id_estado_idx" ON "barra_restock_alertas"("barra_stock_id", "estado");

-- CreateIndex
CREATE INDEX "barra_restock_alertas_barra_id_empresa_id_idx" ON "barra_restock_alertas"("barra_id", "empresa_id");

-- CreateIndex
CREATE INDEX "barra_restock_alertas_consumible_id_empresa_id_idx" ON "barra_restock_alertas"("consumible_id", "empresa_id");

-- CreateIndex
CREATE INDEX "consumibles_promociones_empresa_id_activa_idx" ON "consumibles_promociones"("empresa_id", "activa");

-- CreateIndex
CREATE INDEX "consumibles_promociones_empresa_id_evento_id_idx" ON "consumibles_promociones"("empresa_id", "evento_id");

-- CreateIndex
CREATE INDEX "empleados_actividad_empresa_id_empleado_id_idx" ON "empleados_actividad"("empresa_id", "empleado_id");

-- CreateIndex
CREATE INDEX "empleados_actividad_empresa_id_tipo_idx" ON "empleados_actividad"("empresa_id", "tipo");

-- CreateIndex
CREATE INDEX "empleados_actividad_created_at_idx" ON "empleados_actividad"("created_at");

-- CreateIndex
CREATE INDEX "storage_cleanup_runs_started_at_idx" ON "storage_cleanup_runs"("started_at" DESC);

-- CreateIndex
CREATE INDEX "storage_cleanup_runs_triggered_by_idx" ON "storage_cleanup_runs"("triggered_by");

-- CreateIndex
CREATE INDEX "soporte_mensajes_empresa_id_idx" ON "soporte_mensajes"("empresa_id");

-- CreateIndex
CREATE INDEX "soporte_mensajes_created_at_idx" ON "soporte_mensajes"("created_at");

-- CreateIndex
CREATE INDEX "buyer_phone_verification_challenges_buyer_id_status_expires_idx" ON "buyer_phone_verification_challenges"("buyer_id", "status", "expires_at");

-- CreateIndex
CREATE INDEX "buyer_phone_verification_challenges_empresa_id_phone_e164_idx" ON "buyer_phone_verification_challenges"("empresa_id", "phone_e164");

-- CreateIndex
CREATE INDEX "delivery_dispatch_attempts_checkout_session_id_idx" ON "delivery_dispatch_attempts"("checkout_session_id");

-- CreateIndex
CREATE INDEX "delivery_dispatch_attempts_buyer_id_channel_idx" ON "delivery_dispatch_attempts"("buyer_id", "channel");

-- CreateIndex
CREATE INDEX "delivery_dispatch_attempts_status_channel_idx" ON "delivery_dispatch_attempts"("status", "channel");

-- CreateIndex
CREATE INDEX "rate_limit_buckets_reset_at_ms_idx" ON "rate_limit_buckets"("reset_at_ms");

-- CreateIndex
CREATE INDEX "landing_announcement_active_updated_at_idx" ON "landing_announcement"("active", "updated_at");
