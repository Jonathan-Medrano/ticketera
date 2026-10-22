import type { MarketplaceFeeSummary, PlatformFlow, PlatformRole, SalesReadiness } from "@/components/super-admin/types"
import { formatMoney, formatInt, formatDateTime } from "@/lib/format"

// Re-export canonical formatters so call sites in super-admin don't need changing.
export { formatMoney as money }
// `number` can't be re-exported as a name alias (clashes with TS primitive type),
// so keep a thin wrapper that delegates to the canonical formatter.
export function number(value: number): string {
  return formatInt(value)
}

export function formatFlowLabel(flow: PlatformFlow) {
  return flow === "entradas" ? "Entradas" : "Consumibles"
}

export function formatFeeSummary(summary: MarketplaceFeeSummary | null | undefined) {
  if (!summary?.configured || !summary.mode) return "Sin definir"
  if (summary.mode === "percentage") return `${number(summary.percentage ?? 0)}%`
  if (summary.mode === "fixed") return formatMoney(summary.fixedAmount ?? 0)

  const parts = []
  if (summary.percentage !== null) parts.push(`${formatInt(summary.percentage)}%`)
  if (summary.fixedAmount !== null) parts.push(formatMoney(summary.fixedAmount))
  return parts.join(" + ") || "Híbrida"
}

export function getFeeSourceLabel(summary: MarketplaceFeeSummary | null | undefined) {
  if (!summary?.configured) return "Sin configurar"
  if (summary.source === "empresa") return "Override empresa"
  if (summary.legacyFallback === "empresa_legacy") return "Legacy empresa"
  if (summary.legacyFallback === "env_legacy") return "Default legacy"
  if (summary.source === "global") return "Default global"
  return "Configurado"
}

export function getReadinessLabel(readiness: SalesReadiness | null | undefined, tenantPublicDisabled = false) {
  if (tenantPublicDisabled) {
    return "Dado de baja"
  }

  switch (readiness?.status) {
    case "ready_to_sell":
      return "Lista para vender"
    default:
      return "Sin cobros"
  }
}

export function getPlatformRoleLabel(roleSlug?: PlatformRole["slug"] | null) {
  switch (roleSlug) {
    case "superadmin":
      return "Superadmin"
    case "staff":
      return "Staff platform"
    default:
      return "Staff platform"
  }
}

export function isSingletonOnlyRole(roleSlug?: PlatformRole["slug"] | null, singletonKey?: string | null) {
  return roleSlug === "superadmin" && singletonKey === "superadmin"
}

export function formatPlatformTimestamp(value: string | null | undefined, fallback: string) {
  const formatted = formatDateTime(value)
  return formatted === "—" ? fallback : formatted
}

const AR_TZ = "America/Argentina/Buenos_Aires"

// Axis tick labels need a short format — pinned to AR timezone to avoid browser-tz day-shift bugs.
export function formatBucketShort(bucket: string, periodDays: number): string {
  const date = new Date(bucket)
  if (Number.isNaN(date.getTime())) return bucket
  if (periodDays <= 30) {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "short", timeZone: AR_TZ }).format(date)
  }
  if (periodDays <= 90) {
    return new Intl.DateTimeFormat("es-AR", { day: "2-digit", month: "2-digit", timeZone: AR_TZ }).format(date)
  }
  return new Intl.DateTimeFormat("es-AR", { month: "short", year: "2-digit", timeZone: AR_TZ }).format(date)
}
