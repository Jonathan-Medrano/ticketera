import type { PlatformHealthIssueCompany, PlatformHealthSnapshot, PlatformHealthStatus } from "@/components/super-admin/types"

export type PlatformHealthSeverity = "success" | "warning" | "danger" | "neutral"
export type PlatformHealthSignal = PlatformHealthStatus | "missing_marketplace_fee" | "with_overrides" | null | undefined

export function getPlatformHealthSeverity(signal: PlatformHealthSignal): PlatformHealthSeverity {
  switch (signal) {
    case "ready_to_sell":
      return "success"
    case "missing_collection_setup":
    case "missing_marketplace_fee":
    case "with_overrides":
      return "warning"
    case "deactivated":
      return "neutral"
    default:
      return "neutral"
  }
}

export function getPlatformHealthExecutiveCopy(snapshot: PlatformHealthSnapshot) {
  const actionableIssues = snapshot.issueCounters.total

  switch (snapshot.ownerStatus.status) {
    case "ready_to_sell":
      return actionableIssues > 0
        ? {
          badge: "Operativa parcial",
          title: "La cuenta owner está lista, pero todavía hay fricción comercial",
          description: `La cuenta central ya puede cobrar. Quedan ${actionableIssues} empresa${actionableIssues === 1 ? "" : "s"} para destrabar antes de que la salud comercial quede estable.`,
        }
        : {
          badge: "Operativa estable",
          title: "Owner y empresas están listos para vender",
          description: "La cuenta central está validada y hoy no aparecen empresas frenadas por readiness comercial.",
        }
    case "pending_validation":
      return {
        badge: "Acción recomendada",
        title: "La cuenta owner sigue pendiente de validación",
        description: "La plataforma necesita terminar la validación del cobro central antes de considerar sana la operación owner.",
      }
    case "blocked":
      return {
        badge: "Atención inmediata",
        title: "La cuenta owner está bloqueada",
        description: "El dashboard prioriza esta alerta porque impacta la capacidad de cobrar y necesita revisión operativa inmediata.",
      }
    case "missing_provider":
    default:
      return {
        badge: "Acción inmediata",
        title: "Todavía falta configurar la cuenta owner",
        description: "Antes de mirar crecimiento o comparativas, el owner necesita una cuenta de cobro central configurada y visible.",
      }
  }
}

export function getPlatformHealthPrimaryCta(snapshot: PlatformHealthSnapshot) {
  if (snapshot.ownerStatus.status === "missing_provider") {
    return { label: "Configurar cuenta owner", href: "/super-admin/configuracion" }
  }

  if (snapshot.ownerStatus.status === "pending_validation" || snapshot.ownerStatus.status === "blocked") {
    return { label: "Revisar cuenta owner", href: "/super-admin/configuracion" }
  }

  if (snapshot.issueCounters.total > 0 || snapshot.issueCounters.withOverrides > 0) {
    return { label: "Ir a empresas accionables", href: "/super-admin/empresas" }
  }

  return { label: "Ver configuración global", href: "/super-admin/configuracion" }
}

export function truncatePlatformIssueCompanies(companies: PlatformHealthIssueCompany[], limit = 3) {
  const safeLimit = Math.max(0, limit)
  return {
    items: companies.slice(0, safeLimit),
    hiddenCount: Math.max(companies.length - safeLimit, 0),
  }
}
