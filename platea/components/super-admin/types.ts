export type PlatformFlow = "entradas" | "consumibles"
export type PlatformFeeMode = "percentage" | "fixed" | "hybrid"
export type PlatformHealthStatus = "missing_collection_setup" | "ready_to_sell" | "deactivated"
export type PlatformOwnerHealthStatus = "ready_to_sell" | "pending_validation" | "blocked" | "missing_provider"
export type PlatformOwnerPaymentConnectionMode = "manual" | "oauth"
export type PlatformDirectPermissionKey = "platform_dashboard" | "platform_empresas" | "platform_configuracion" | "platform_usuarios"
export type PlatformDirectPermissions = Record<PlatformDirectPermissionKey, boolean>
export type PlatformCapabilityKey =
  | "platform.users.read"
  | "platform.users.write"
  | "platform.users.capabilities.grant"
  | "platform.revenue.view.own"
  | "platform.revenue.view.branch"
  | "platform.revenue.view.global"
  | "platform.companies.read"
  | "platform.settings.read"
  | "platform.companies.overrides.edit"
  | "platform.fees.defaults.edit"
  | "platform.alerts.receive"
export type PlatformViewerScope = "own" | "branch" | "global"

export type PlatformViewerPolicy = {
  actorUserId: string
  parentUserId: string | null
  branchRootUserId: string
  rootUserId: string
  roleLabel: string
  isRoot: boolean
  compatibilityMode: "grants" | "legacy_fallback"
  capabilities: PlatformCapabilityKey[]
  capabilityCeiling: PlatformCapabilityKey[]
  revenueVisibilityScope: PlatformViewerScope
}

export type PlatformCapabilityCatalogEntry = {
  key: PlatformCapabilityKey
  domain: "users" | "revenue" | "companies" | "fees"
  label: string
}

export type PlatformBranchTreeNode = {
  userId: string
  parentUserId: string | null
  branchRootUserId: string
  nombre: string
  roleLabel: string
  depth: number
  activo: boolean
  children: PlatformBranchTreeNode[]
}

export type SalesReadiness = {
  status: string
  reason: string | null
  canSell: boolean
}

export type MarketplaceFeeSummary = {
  flow: PlatformFlow
  configured: boolean
  source: "global" | "empresa" | null
  legacyFallback: "empresa_legacy" | "env_legacy" | null
  mode: PlatformFeeMode | null
  percentage: number | null
  fixedAmount: number | null
}

export type PlatformFlowMetrics = {
  ventasTotales: number
  volumenBruto: number
  gananciasOwner: number
}

export type PlatformMetricas = {
  empresasActivas: number
  ventasTotales: number
  volumenBruto: number
  gananciasOwner: number
}

export type PlatformMetricScope = {
  historicoTotal: PlatformMetricas
  soloEmpresasActivas: PlatformMetricas
  marketplace: PlatformMetricas
}

export type PlatformCompanySummary = {
  id: string
  nombre: string
  slug: string
  activa: boolean
  aprobada?: boolean
  esPrueba?: boolean
  tenantPublicDisabled?: boolean
  suspendido?: boolean
  revendedorHabilitado?: boolean
  consumiblesHabilitado?: boolean
  created_at?: string
  gananciasOwner: number
  volumenBruto: number
  ventas: number
  metricasPorFlow: Record<PlatformFlow, PlatformFlowMetrics>
  salesReadiness: SalesReadiness
  marketplaceFeeByFlow: Record<PlatformFlow, MarketplaceFeeSummary>
}

export type PlatformDashboardData = {
  metricas: PlatformMetricas
  metricasScope: PlatformMetricScope
  metricasPorFlow: Record<PlatformFlow, PlatformFlowMetrics>
  gananciasPorDia: Array<{ dia: string; total: number }>
  empresasResumen: PlatformCompanySummary[]
  healthSnapshot: PlatformHealthSnapshot
  viewerScope?: PlatformViewerScope
  profitSharing?: PlatformProfitSharingOverview
}

export type PlatformHealthOwnerStatus = {
  status: PlatformOwnerHealthStatus
  reason: string | null
  updatedAt: string | null
}

export type PlatformHealthIssueCompany = {
  id: string
  nombre: string
  slug: string
  activa: boolean
  withOverrides: boolean
  readiness: SalesReadiness
}

export type PlatformHealthIssueCompanies = {
  missingCollectionSetup: PlatformHealthIssueCompany[]
  deactivated: PlatformHealthIssueCompany[]
  missingMarketplaceFee: PlatformHealthIssueCompany[]
  withOverrides: PlatformHealthIssueCompany[]
}

export type PlatformHealthSnapshot = {
  ownerPaymentAccount: PlatformOwnerPaymentAccount
  currentUserPaymentAccount?: PlatformOwnerPaymentAccount
  ownerStatus: PlatformHealthOwnerStatus
  readinessBuckets: Record<PlatformHealthStatus, number>
  issueCounters: {
    total: number
    missingCollectionSetup: number
    deactivated: number
    missingMarketplaceFee: number
    withOverrides: number
  }
  issueCompanies: PlatformHealthIssueCompanies
}

export type PlatformDashboardResponseData = {
  metricas: PlatformMetricas
  metricasScope?: PlatformMetricScope
  metricas_scope?: PlatformMetricScope
  metricasPorFlow?: Record<PlatformFlow, PlatformFlowMetrics>
  metricas_por_flow?: Record<PlatformFlow, PlatformFlowMetrics>
  gananciasPorDia?: PlatformDashboardData["gananciasPorDia"]
  ganancias_por_dia?: PlatformDashboardData["gananciasPorDia"]
  empresasResumen?: PlatformDashboardData["empresasResumen"]
  empresas_resumen?: PlatformDashboardData["empresasResumen"]
  healthSnapshot?: PlatformHealthSnapshot
  health_snapshot?: PlatformHealthSnapshot
  viewerScope?: PlatformViewerScope
  viewer_scope?: PlatformViewerScope
  profitSharing?: PlatformProfitSharingOverview
  profit_sharing?: PlatformProfitSharingOverview
}

function buildEmptyFlowMetrics(): PlatformFlowMetrics {
  return {
    ventasTotales: 0,
    volumenBruto: 0,
    gananciasOwner: 0,
  }
}

function buildEmptyPlatformMetricas(): PlatformMetricas {
  return {
    empresasActivas: 0,
    ventasTotales: 0,
    volumenBruto: 0,
    gananciasOwner: 0,
  }
}

export function buildEmptyPlatformHealthSnapshot(): PlatformHealthSnapshot {
  return {
    ownerPaymentAccount: null,
    ownerStatus: {
      status: "missing_provider",
      reason: "missing_provider",
      updatedAt: null,
    },
    readinessBuckets: {
      missing_collection_setup: 0,
      ready_to_sell: 0,
      deactivated: 0,
    },
    issueCounters: {
      total: 0,
      missingCollectionSetup: 0,
      deactivated: 0,
      missingMarketplaceFee: 0,
      withOverrides: 0,
    },
    issueCompanies: {
      missingCollectionSetup: [],
      deactivated: [],
      missingMarketplaceFee: [],
      withOverrides: [],
    },
  }
}

export function normalizePlatformDashboardData(contract: PlatformDashboardResponseData): PlatformDashboardData {
  const emptyFlowMetrics = buildEmptyFlowMetrics()
  const emptyMetricas = buildEmptyPlatformMetricas()

  return {
    metricas: contract.metricas,
    metricasScope: contract.metricasScope ?? contract.metricas_scope ?? {
      historicoTotal: contract.metricas ?? emptyMetricas,
      soloEmpresasActivas: contract.metricas ?? emptyMetricas,
      marketplace: contract.metricas ?? emptyMetricas,
    },
    metricasPorFlow: contract.metricasPorFlow ?? contract.metricas_por_flow ?? {
      entradas: emptyFlowMetrics,
      consumibles: emptyFlowMetrics,
    },
    gananciasPorDia: contract.gananciasPorDia ?? contract.ganancias_por_dia ?? [],
    empresasResumen: contract.empresasResumen ?? contract.empresas_resumen ?? [],
    healthSnapshot: contract.healthSnapshot ?? contract.health_snapshot ?? buildEmptyPlatformHealthSnapshot(),
    viewerScope: contract.viewerScope ?? contract.viewer_scope,
    profitSharing: contract.profitSharing ?? contract.profit_sharing,
  }
}

export type PlatformCompanyDetail = {
  empresaId: string
  empresaNombre: string
  volumenBruto: number
  gananciasOwner: number
  ventas: number
  serieTemporal: Array<{ dia: string; total: number }>
  metricasPorFlow: Record<PlatformFlow, PlatformFlowMetrics>
  salesReadiness: SalesReadiness
  marketplaceFeeByFlow: Record<PlatformFlow, MarketplaceFeeSummary>
}

export type PlatformOwnerPaymentAccount = {
  id: string
  provider: "mercadopago"
  status: "pending_validation" | "ready_to_sell" | "blocked"
  reason: string | null
  credentialLast4: string | null
  providerAccountLabel: string | null
  connectionMode?: PlatformOwnerPaymentConnectionMode
  oauthConnectedAt?: string | null
  validatedAt: string | null
  blockedAt: string | null
  updatedAt: string
} | null

export type PlatformProfitSharingUserSummary = {
  userId: string
  nombre: string
  roleSlug: PlatformRole["slug"]
  isSingletonSuperadmin: boolean
  permissions: PlatformDirectPermissions
  configuredShareByFlow: Record<PlatformFlow, number>
  effectiveRevenueByFlow: Record<PlatformFlow, number>
  fallbackRevenueByFlow: Record<PlatformFlow, number>
}

export type PlatformProfitSharingCutoff = {
  startsAt: string | null
  source: "first_allocation"
}

export type PlatformProfitSharingOverview = {
  cutoff: PlatformProfitSharingCutoff
  totalsByFlow: Record<PlatformFlow, { ownerFeeTotal: number; assignedPercentage: number; remainderPercentage: number; overflowPercentage?: number; isOverallocated?: boolean }>
  users: PlatformProfitSharingUserSummary[]
}

export type PlatformCompanyFeesData = {
  empresaId: string
  defaultsByFlow: Record<PlatformFlow, MarketplaceFeeSummary>
  overridesByFlow: Record<PlatformFlow, MarketplaceFeeSummary>
  resolvedByFlow: Record<PlatformFlow, MarketplaceFeeSummary>
}

export type PlatformFeeConfigurationData = {
  defaultsByFlow: Record<PlatformFlow, MarketplaceFeeSummary>
  ownerPaymentAccount: PlatformOwnerPaymentAccount
  currentUserPaymentAccount?: PlatformOwnerPaymentAccount
  profitSharingCutoff: PlatformProfitSharingCutoff
  viewerScope?: PlatformViewerScope
}

export type PlatformRole = {
  slug: "superadmin" | "staff"
  nombre: string
  descripcion: string
  singleton: boolean
  editable: boolean
}

export type PlatformUser = {
  id: string
  nombre: string
  email: string
  loginAlias: string
  roleSlug: PlatformRole["slug"]
  roleLabel?: string
  permisos: PlatformDirectPermissions
  capabilities?: PlatformCapabilityKey[]
  activo: boolean
  isSingletonSuperadmin: boolean
  parentUserId?: string | null
  branchRootUserId?: string
  paymentAccount: PlatformOwnerPaymentAccount
  shareByFlow: Record<PlatformFlow, number>
  revenueGrants?: Record<PlatformFlow, number>
  createdAt: string
  updatedAt: string
}

export type PlatformUsersEnvelope = {
  usuarios: PlatformUser[]
  viewerPolicy: PlatformViewerPolicy
  capabilityCatalog: PlatformCapabilityCatalogEntry[]
  branchTree: PlatformBranchTreeNode[]
  revenueVisibilityScope: PlatformViewerScope
}

export type PlatformCobrosData = {
  ownerPaymentAccount: PlatformOwnerPaymentAccount
  currentUserPaymentAccount: PlatformOwnerPaymentAccount
  paymentAccounts: PlatformOwnerPaymentAccount[]
}
