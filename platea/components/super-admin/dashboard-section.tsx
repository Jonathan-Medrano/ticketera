"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useMemo, useState } from "react"
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { Building2, Crown, Package, Ticket, TrendingUp } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { getPlatformHealthSeverity, truncatePlatformIssueCompanies } from "@/components/super-admin/dashboard-health"
import type { PlatformHealthSignal } from "@/components/super-admin/dashboard-health"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import type { PlatformCompanySummary, PlatformDashboardData, PlatformHealthStatus, PlatformProfitSharingCutoff, PlatformViewerScope } from "@/components/super-admin/types"
import { formatFlowLabel, formatPlatformTimestamp, getPlatformRoleLabel, getReadinessLabel, money, number } from "@/components/super-admin/utils"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"

const readinessCards: Array<{ key: PlatformHealthStatus; label: string; hint: string }> = [
  { key: "ready_to_sell", label: "Listas para vender", hint: "Red operativa que ya puede cobrar sin fricción." },
  { key: "missing_collection_setup", label: "Sin cobro configurado", hint: "Todavía no pueden cobrar porque falta conexión, validación o configuración comercial." },
  { key: "deactivated", label: "Dadas de baja", hint: "Tenants fuera de operación o no visibles para vender." },
]

const overridesCard = {
  label: "Con overrides",
  hint: "Empresas con excepción comercial manual activa sobre el fee resuelto.",
}

const severityStyles = {
  success: {
    panel: "border-success/30 bg-success/8",
    badge: "border-success/30 bg-success/15 text-success",
    accent: "text-success",
  },
  warning: {
    panel: "border-warning/30 bg-warning/8",
    badge: "border-warning/30 bg-warning/15 text-warning",
    accent: "text-warning",
  },
  danger: {
    panel: "border-destructive/30 bg-destructive/8",
    badge: "border-destructive/30 bg-destructive/15 text-destructive",
    accent: "text-destructive",
  },
  neutral: {
    panel: "border-border bg-card",
    badge: "border-border bg-secondary text-muted-foreground",
    accent: "text-muted-foreground",
  },
} as const

const issuePriorityOrder = {
  missingCollectionSetup: 0,
  deactivated: 1,
  missingMarketplaceFee: 2,
  withOverrides: 4,
} as const

function getCompanyPriorityScore(company: PlatformCompanySummary) {
  if (company.salesReadiness.status === "blocked") return 0
  if (company.salesReadiness.status === "missing_provider") return 1
  if (company.salesReadiness.status === "pending_validation") return 2
  if (company.salesReadiness.reason === "missing_marketplace_fee") return 3
  if (Object.values(company.marketplaceFeeByFlow).some((summary) => summary.source === "empresa")) return 4
  return 5
}

function getCompanyImpactScore(company: PlatformCompanySummary) {
  const priorityScore = getCompanyPriorityScore(company)
  return ((6 - priorityScore) * 1_000_000) + company.gananciasOwner + (company.volumenBruto * 0.35) + (company.ventas * 15)
}

function formatFlowComparison(flow: "entradas" | "consumibles", dashboard: PlatformDashboardData) {
  const metrics = dashboard.metricasPorFlow[flow]
  const otherFlow = flow === "entradas" ? "consumibles" : "entradas"
  const otherMetrics = dashboard.metricasPorFlow[otherFlow]
  const salesGap = metrics.ventasTotales - otherMetrics.ventasTotales
  const ownerGap = metrics.gananciasOwner - otherMetrics.gananciasOwner

  const salesCopy = salesGap === 0
    ? `Mismo volumen de ventas que ${formatFlowLabel(otherFlow).toLowerCase()}.`
    : salesGap > 0
      ? `${number(salesGap)} ventas más que ${formatFlowLabel(otherFlow).toLowerCase()}.`
      : `${number(Math.abs(salesGap))} ventas menos que ${formatFlowLabel(otherFlow).toLowerCase()}.`

  const ownerCopy = ownerGap === 0
    ? "Aporta la misma ganancia owner."
    : ownerGap > 0
      ? `${money(ownerGap)} más de ganancia owner.`
      : `${money(Math.abs(ownerGap))} menos de ganancia owner.`

  return `${salesCopy} ${ownerCopy}`
}

function getProfitSharingCutoffCopy(cutoff: PlatformProfitSharingCutoff | undefined, scope: PlatformViewerScope) {
  if (!cutoff?.startsAt) {
    return scope === "own"
      ? "Tus números empiezan cuando exista la primera allocation nueva. No incluyen histórico anterior."
      : scope === "branch"
        ? "Los números de tu rama empiezan cuando exista la primera allocation nueva. No incluyen histórico anterior."
      : "Todavía no existe un corte activo de profit sharing. El histórico previo queda afuera cuando aparezca la primera allocation nueva."
  }

  const formatted = formatPlatformTimestamp(cutoff.startsAt, "Pendiente")
  return scope === "own"
    ? `Tus números de profit sharing aplican desde ${formatted}.`
    : scope === "branch"
      ? `Los números de tu rama aplican desde ${formatted}.`
    : `El reparto platform aplica desde ${formatted}.`
}

function formatChartDay(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value

  return date.toLocaleDateString("es-AR", {
    day: "2-digit",
    month: "short",
    timeZone: "America/Argentina/Buenos_Aires",
  })
}

function PanelHeading({ title, description, action }: { title: string; description: string; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <p className="text-lg font-semibold text-foreground">{title}</p>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {action ? <div>{action}</div> : null}
    </div>
  )
}

function MetricCard({ label, value, hint, icon: Icon, accent = false }: { label: string; value: string; hint: string; icon: typeof TrendingUp; accent?: boolean }) {
  return (
    <SAKpiCard tone={accent ? "primary" : "neutral"} className={cn("relative overflow-hidden p-5", accent && "shadow-[var(--superadmin-accent-shadow)]")}>
      {accent ? <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" /> : null}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className={saKpiLabelCn}>{label}</p>
          <p className={cn(saKpiValueCn, "font-mono mt-2.5 text-[28px] tracking-tight", accent && "text-primary")}>{value}</p>
          <p className="mt-2 text-[12px] text-muted-foreground">{hint}</p>
        </div>
        <div className={cn(
          "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl",
          accent ? "bg-primary/10 text-primary" : "bg-secondary text-muted-foreground"
        )}>
          <Icon className="h-[18px] w-[18px]" />
        </div>
      </div>
    </SAKpiCard>
  )
}

function ScopeMetricCard({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return (
    <div className="rounded-xl border border-border/60 bg-secondary/60 px-4 py-4">
      <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">{title}</p>
      <p className="mt-2 text-[22px] font-semibold leading-none tabular-nums text-foreground">{value}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{subtitle}</p>
    </div>
  )
}

export default function DashboardSection({ ownerName, dashboard }: { ownerName: string; dashboard: PlatformDashboardData }) {
  const router = useRouter()
  const [period, setPeriod] = useState<"7d" | "30d" | "90d">("30d")
  const [confirmDisconnect, setConfirmDisconnect] = useState(false)
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme

  const chartData = useMemo(() => {
    const cutoffDays = period === "7d" ? 7 : period === "30d" ? 30 : 90
    const cutoff = new Date()
    cutoff.setDate(cutoff.getDate() - cutoffDays)
    return [...dashboard.gananciasPorDia]
      .filter((d) => new Date(d.dia) >= cutoff)
      .sort((a, b) => new Date(a.dia).getTime() - new Date(b.dia).getTime())
  }, [dashboard.gananciasPorDia, period])

  if (dashboard.viewerScope && dashboard.viewerScope !== "global") {
    const currentUser = dashboard.profitSharing?.users[0]
    const isBranchScope = dashboard.viewerScope === "branch"

    async function connectOwnAccount() {
      const res = await fetch("/api/platform/cobros/mercadopago/oauth/start", { method: "POST" })
      const data = await res.json() as { authUrl?: string; error?: string }
      if (!res.ok || !data.authUrl) {
        toast.error(data.error ?? "No se pudo iniciar la conexión con Mercado Pago")
        return
      }

      window.location.assign(data.authUrl)
    }

    async function disconnectOwnAccount() {
      const res = await fetch("/api/platform/cobros/mercadopago", { method: "DELETE" })
      const data = await res.json() as { error?: string }
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo desconectar la cuenta")
        return
      }

      toast.success("Cuenta Mercado Pago desconectada")
      router.refresh()
    }

    return (
      <>
      <div className="space-y-8">
        <div className="grid gap-4 lg:grid-cols-3">
          <MetricCard label={isBranchScope ? "Ganancia total de tu rama" : "Tu ganancia total"} value={money(dashboard.metricas.gananciasOwner)} hint={getProfitSharingCutoffCopy(dashboard.profitSharing?.cutoff, dashboard.viewerScope)} icon={Crown} accent />
          {(["entradas", "consumibles"] as const).map((flow) => (
            <MetricCard
              key={flow}
              label={formatFlowLabel(flow)}
              value={money(dashboard.metricasPorFlow[flow].gananciasOwner)}
              hint={isBranchScope
                ? `Retenido por la rama: ${dashboard.profitSharing?.users.reduce((acc, user) => acc + (user.configuredShareByFlow?.[flow] ?? 0), 0) ?? 0}%`
                : `Configurado: ${currentUser?.configuredShareByFlow?.[flow] ?? 0}%`}
              icon={flow === "entradas" ? Ticket : Package}
            />
          ))}
        </div>

        <SuperAdminPanel>
          <PanelHeading
            title="Tu cuenta Mercado Pago"
            description={isBranchScope
              ? "Tu cuenta sigue siendo relevante para la rama: si no está lista, el payout burbujea al ancestro listo más cercano."
              : "Si no está lista, tu porcentaje sigue configurado pero su destino efectivo cae al superadmin principal."}
            action={
              <div className="flex flex-wrap gap-2">
                {dashboard.healthSnapshot.currentUserPaymentAccount ? (
                  <>
                    <Button variant="outline" className="border-border/80 bg-transparent" onClick={connectOwnAccount}>Reconectar</Button>
                    <Button variant="outline" className="border-border/80 bg-transparent" onClick={() => setConfirmDisconnect(true)}>Desconectar</Button>
                  </>
                ) : (
                  <Button variant="outline" className="border-border/80 bg-transparent" onClick={connectOwnAccount}>Conectar</Button>
                )}
              </div>
            }
          />

          <div className="mt-6 grid gap-4 md:grid-cols-2">
            <ScopeMetricCard
              title="Estado"
              value={dashboard.healthSnapshot.currentUserPaymentAccount ? getReadinessLabel({ status: dashboard.healthSnapshot.currentUserPaymentAccount.status, reason: dashboard.healthSnapshot.currentUserPaymentAccount.reason, canSell: dashboard.healthSnapshot.currentUserPaymentAccount.status === "ready_to_sell" }) : "Sin cuenta conectada"}
              subtitle="Lectura operativa de readiness de tu cuenta."
            />
            <ScopeMetricCard
              title="Cuenta"
              value={dashboard.healthSnapshot.currentUserPaymentAccount?.providerAccountLabel ?? "Mercado Pago no conectado"}
              subtitle={dashboard.healthSnapshot.currentUserPaymentAccount?.credentialLast4 ?? "Sin credencial visible"}
            />
          </div>

          {isBranchScope && dashboard.profitSharing?.users?.length ? (
            <div className="mt-6 rounded-xl border border-border/70 bg-secondary/60 p-4">
              <p className="text-sm font-semibold text-foreground">Participantes de tu rama</p>
              <div className="mt-3 space-y-2">
                {dashboard.profitSharing.users.map((user) => (
                  <div key={user.userId} className="flex items-center justify-between gap-3 rounded-lg border border-border/60 bg-background/80 px-3 py-3 text-sm">
                    <div>
                      <p className="font-medium text-foreground">{user.nombre}</p>
                      <p className="text-xs text-muted-foreground">{getPlatformRoleLabel(user.roleSlug)}</p>
                    </div>
                    <div className="text-right text-xs text-muted-foreground">
                      <p>Entradas: {number(user.configuredShareByFlow.entradas)}%</p>
                      <p>Consumibles: {number(user.configuredShareByFlow.consumibles)}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </SuperAdminPanel>
      </div>

      <Dialog open={confirmDisconnect} onOpenChange={(open) => { if (!open) setConfirmDisconnect(false) }}>
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope max-w-md">
          <DialogHeader>
            <DialogTitle>Desconectar Mercado Pago</DialogTitle>
            <DialogDescription>
              Vas a desconectar tu cuenta de Mercado Pago. Tus ganancias no tendrán destino hasta que vuelvas a conectarla.
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setConfirmDisconnect(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                setConfirmDisconnect(false)
                void disconnectOwnAccount()
              }}
            >
              Desconectar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      </>
    )
  }

  const issueCards: Array<{
    key: string
    title: string
    description: string
    count: number
    companies: PlatformDashboardData["healthSnapshot"]["issueCompanies"][keyof PlatformDashboardData["healthSnapshot"]["issueCompanies"]]
    signal: PlatformHealthSignal
    href: string
    cta: string
  }> = [
    {
      key: "missingCollectionSetup",
      title: "Empresas sin cobro configurado",
      description: "Falta conexión, validación o alguna configuración mínima para empezar a cobrar.",
      count: dashboard.healthSnapshot.issueCounters.missingCollectionSetup,
      companies: dashboard.healthSnapshot.issueCompanies.missingCollectionSetup,
      signal: "missing_collection_setup" as const,
      href: "/super-admin/empresas",
      cta: "Revisar empresas",
    },
    {
      key: "deactivated",
      title: "Empresas dadas de baja",
      description: "Tenants fuera de operación que ya no deberían contarse como red lista para vender.",
      count: dashboard.healthSnapshot.issueCounters.deactivated,
      companies: dashboard.healthSnapshot.issueCompanies.deactivated,
      signal: "deactivated" as const,
      href: "/super-admin/empresas",
      cta: "Ver estado operativo",
    },
    {
      key: "missingMarketplaceFee",
      title: "Fee marketplace faltante",
      description: "Hay cobro configurado pero no comercialización completa por flow.",
      count: dashboard.healthSnapshot.issueCounters.missingMarketplaceFee,
      companies: dashboard.healthSnapshot.issueCompanies.missingMarketplaceFee,
      signal: "missing_marketplace_fee" as const,
      href: "/super-admin/configuracion",
      cta: "Configurar fees",
    },
    {
      key: "withOverrides",
      title: "Overrides activos",
      description: "Visibilidad de excepciones manuales sensibles en la red.",
      count: dashboard.healthSnapshot.issueCounters.withOverrides,
      companies: dashboard.healthSnapshot.issueCompanies.withOverrides,
      signal: "with_overrides" as const,
      href: "/super-admin/empresas",
      cta: "Ver overrides",
    },
  ]
    .filter((issue) => issue.count > 0)
    .sort((a, b) => {
      const priorityGap = issuePriorityOrder[a.key as keyof typeof issuePriorityOrder] - issuePriorityOrder[b.key as keyof typeof issuePriorityOrder]
      if (priorityGap !== 0) return priorityGap
      return b.count - a.count
    })

  return (
    <div className="space-y-6 md:space-y-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-md border border-primary/20 bg-primary/8 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.22em] text-primary">Platform Console</span>
          </div>
          <h1 className="mt-3 text-[26px] font-semibold tracking-tight text-foreground">Hola, {ownerName.split(" ")[0] || ownerName}</h1>
          <p className="mt-1 text-sm text-muted-foreground">Salud de la red, ingresos del owner y reparto, en una sola vista.</p>
        </div>
        <Badge variant="outline" className="mt-1 border-border/70 bg-secondary/80 text-muted-foreground">Vista global</Badge>
      </header>

      {/* HERO: comisión owner + estado de la red */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
        <div className="relative overflow-hidden rounded-2xl border border-primary/25 bg-primary/5 p-6 shadow-[var(--superadmin-accent-shadow)]">
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" />
          <div aria-hidden className="pointer-events-none absolute bottom-0 right-0 h-48 w-48 rounded-full bg-primary/6 blur-3xl" />
          <div className="relative">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-primary/70">Comisión owner total</p>
            <p className="mt-2 font-mono text-[32px] font-bold leading-none tracking-tight tabular-nums text-primary sm:text-[40px] lg:text-[52px]">
              {money(dashboard.metricas.gananciasOwner)}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">Ganancia efectiva acumulada del owner.</p>
            <div className="mt-6 grid grid-cols-1 gap-4 border-t border-primary/15 pt-5 sm:grid-cols-3">
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Empresas activas</p>
                <p className="mt-1.5 text-[22px] font-semibold leading-none tabular-nums text-foreground">{number(dashboard.metricas.empresasActivas)}</p>
              </div>
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Operaciones</p>
                <p className="mt-1.5 text-[22px] font-semibold leading-none tabular-nums text-foreground">{number(dashboard.metricas.ventasTotales)}</p>
              </div>
              <div>
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Volumen bruto</p>
                <p className="mt-1.5 font-mono text-[22px] font-semibold leading-none tabular-nums text-foreground">{money(dashboard.metricas.volumenBruto)}</p>
              </div>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">Estado de la red</p>
          {readinessCards.map((bucket) => {
            const bucketSeverity = getPlatformHealthSeverity(bucket.key)
            const count = dashboard.healthSnapshot.readinessBuckets[bucket.key]
            const textStyle = bucketSeverity === "success"
              ? { label: "text-success", value: "text-success" }
              : bucketSeverity === "warning"
                ? { label: "text-warning", value: "text-warning" }
                : bucketSeverity === "danger"
                  ? { label: "text-destructive", value: "text-destructive" }
                  : { label: "text-muted-foreground", value: "text-foreground" }
            return (
              <div key={bucket.key} title={bucket.hint} className={cn("flex items-center justify-between rounded-xl border px-4 py-3", severityStyles[bucketSeverity].panel)}>
                <p className={cn("text-xs font-medium", textStyle.label)}>{bucket.label}</p>
                <p className={cn("text-2xl font-semibold tabular-nums", textStyle.value)}>{number(count)}</p>
              </div>
            )
          })}
          <div
            className={cn("flex items-center justify-between rounded-xl border px-4 py-3", severityStyles.warning.panel)}
            title={overridesCard.hint}
          >
            <p className={cn("text-xs font-medium", severityStyles.warning.accent)}>{overridesCard.label}</p>
            <p className={cn("text-2xl font-semibold tabular-nums", severityStyles.warning.accent)}>{number(dashboard.healthSnapshot.issueCounters.withOverrides)}</p>
          </div>
        </div>
      </div>

      {/* Gráfico: full-width */}
      <SuperAdminPanel className="flex h-full flex-col p-5 shadow-[var(--superadmin-panel-shadow)] ring-1 ring-primary/10">
        <PanelHeading
          title="Ganancias por día"
          description="Serie consolidada de entradas y consumibles para una lectura ejecutiva rápida."
          action={
            <div className="flex h-9 gap-1 rounded-full border border-border/60 p-1">
              {(["7d", "30d", "90d"] as const).map((p) => (
                <button
                  key={p}
                  onClick={() => setPeriod(p)}
                  className={cn(
                    "rounded-full px-3 text-xs font-medium transition-colors",
                    period === p ? "bg-primary text-primary-foreground" : "bg-secondary text-muted-foreground"
                  )}
                >
                  {p}
                </button>
              ))}
            </div>
          }
        />

        {chartData.length === 0 ? (
          <div className="mt-8 flex min-h-[260px] flex-1 flex-col items-center justify-center rounded-xl border border-dashed border-border/70 px-6 text-center">
            <TrendingUp className="h-8 w-8 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium text-foreground">Todavía no hay ganancias para graficar</p>
            <p className="mt-1 text-xs text-muted-foreground">Cuando empiecen las ventas vas a ver la evolución diaria acá.</p>
          </div>
        ) : (
          <div className="mt-8 min-h-[260px] flex-1">
            <ResponsiveContainer width="100%" height={260}>
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="ownerGain" x1="0" x2="0" y1="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.5} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.03} />
                  </linearGradient>
                </defs>
                <CartesianGrid stroke="var(--superadmin-chart-grid)" vertical={false} />
                <XAxis dataKey="dia" stroke="var(--muted-foreground)" tickLine={false} axisLine={false} tickFormatter={formatChartDay} minTickGap={32} />
                <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} tickFormatter={(value) => money(Number(value))} width={100} />
                <Tooltip contentStyle={{ background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 20, color: "var(--popover-foreground)" }} formatter={(value) => money(Number(value ?? 0))} labelFormatter={(label) => formatChartDay(String(label ?? ""))} />
                <Area type="monotone" dataKey="total" stroke="var(--primary)" fill="url(#ownerGain)" strokeWidth={3} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </SuperAdminPanel>

      <div className="grid items-stretch gap-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(300px,0.95fr)]">
        <SuperAdminPanel className="h-full">
          <PanelHeading
            title="Issues accionables"
            description="Los frentes concretos que hoy frenan o desvían la operación."
            action={<Link href="/super-admin/empresas" className="text-sm font-medium text-primary hover:text-primary/80">Ver todas las empresas</Link>}
          />

          {issueCards.length === 0 ? (
            <div className="mt-6 rounded-xl border border-success/30 bg-success/8 px-4 py-5 text-sm text-success">
              No hay empresas fuera de readiness comercial hoy. El dashboard queda enfocado en crecimiento.
            </div>
          ) : (
            <div className="mt-6 grid gap-4 md:grid-cols-2">
              {issueCards.slice(0, 4).map((issue) => {
                const issueSeverity = getPlatformHealthSeverity(issue.signal)
                const truncated = truncatePlatformIssueCompanies(issue.companies)
                const accentCn = issueSeverity === "danger"
                  ? "bg-destructive"
                  : issueSeverity === "warning"
                    ? "bg-warning"
                    : "bg-foreground"

                return (
                  <div key={issue.key} className={cn("overflow-hidden rounded-xl border", severityStyles[issueSeverity].panel)}>
                    <div aria-hidden className={cn("h-[3px]", accentCn)} />
                    <div className="p-5">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-semibold text-foreground">{issue.title}</p>
                          <p className="mt-1 text-sm leading-5 text-muted-foreground">{issue.description}</p>
                        </div>
                        <Badge variant="outline" className={cn(severityStyles[issueSeverity].badge, "shrink-0")}>{number(issue.count)}</Badge>
                      </div>

                      <div className="mt-4 space-y-2">
                        {truncated.items.map((company) => (
                          <div key={`${issue.key}-${company.id}`} className="flex items-center justify-between rounded-lg border border-border/50 bg-background/80 px-3 py-2.5">
                            <div>
                              <p className="text-sm font-medium text-foreground">{company.nombre}</p>
                              <p className="text-[11px] text-muted-foreground">{company.slug}.ticketera.com</p>
                            </div>
                          </div>
                        ))}
                      </div>

                      {truncated.hiddenCount > 0 ? <p className="mt-3 text-xs text-muted-foreground">+{number(truncated.hiddenCount)} empresa{truncated.hiddenCount === 1 ? "" : "s"} más en este bucket.</p> : null}

                      <Button asChild size="sm" variant="ghost" className="mt-4 h-8 w-full rounded-lg border border-border/50 bg-transparent text-xs">
                        <Link href={issue.href}>{issue.cta}</Link>
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </SuperAdminPanel>

        <div className="flex h-full flex-col space-y-6">
          <SuperAdminPanel className="h-full">
            <PanelHeading title="Lectura rápida por flow" description="Compará entradas y consumibles sin mezclar significados." />
            <div className="mt-5 space-y-3">
              {(["entradas", "consumibles"] as const).map((flow) => {
                const metrics = dashboard.metricasPorFlow[flow]
                const Icon = flow === "entradas" ? Ticket : Package
                const isEntradas = flow === "entradas"

                return (
                  <div key={flow} className="overflow-hidden rounded-xl border border-border/70">
                    <div className={cn(
                      "flex items-center gap-3 border-b px-4 py-3",
                      isEntradas ? "border-primary/20 bg-primary/6" : "border-border bg-secondary/60"
                    )}>
                      <div className={cn(
                        "flex h-8 w-8 items-center justify-center rounded-lg",
                        isEntradas ? "bg-primary/15 text-primary" : "bg-secondary text-foreground"
                      )}>
                        <Icon className="h-4 w-4" />
                      </div>
                      <div>
                        <p className={cn("text-sm font-semibold", isEntradas ? "text-primary" : "text-foreground")}>{formatFlowLabel(flow)}</p>
                        <p className="text-xs text-muted-foreground">{formatFlowComparison(flow, dashboard)}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-1 divide-y divide-border/50 bg-card sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                      <div className="flex flex-col items-center px-3 py-4 text-center">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Ops</p>
                        <p className="mt-1.5 text-[20px] font-semibold leading-none tabular-nums text-foreground">{number(metrics.ventasTotales)}</p>
                      </div>
                      <div className="flex flex-col items-center px-3 py-4 text-center">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Cobrado</p>
                        <p className="mt-1.5 font-mono text-[16px] font-semibold leading-none tabular-nums text-foreground">{money(metrics.volumenBruto)}</p>
                      </div>
                      <div className="flex flex-col items-center px-3 py-4 text-center">
                        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Comisión</p>
                        <p className="mt-1.5 font-mono text-[16px] font-semibold leading-none tabular-nums text-primary">{money(metrics.gananciasOwner)}</p>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </SuperAdminPanel>

        </div>
      </div>

      {dashboard.profitSharing ? (
        <SuperAdminPanel>
          <PanelHeading title="Reparto platform por flow" description="Vista compacta del reparto actual y su ganancia efectiva." />

          <div className="mt-2">
            <p className="text-sm text-muted-foreground">{getProfitSharingCutoffCopy(dashboard.profitSharing.cutoff, "global")}</p>
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {(["entradas", "consumibles"] as const).map((flow) => (
              <div key={flow} className="rounded-xl border border-border/60 bg-card p-5">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{formatFlowLabel(flow)}</p>
                <p className="mt-3 font-mono text-[36px] font-bold leading-none tabular-nums text-primary">{money(dashboard.profitSharing!.totalsByFlow[flow].ownerFeeTotal)}</p>
                <div className="mt-4 space-y-1.5 border-t border-border/40 pt-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Asignado a secundarios</span>
                    <span className="font-mono tabular-nums">{number(dashboard.profitSharing!.totalsByFlow[flow].assignedPercentage)}%</span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Sobrante owner</span>
                    <span className="font-mono tabular-nums">{number(dashboard.profitSharing!.totalsByFlow[flow].remainderPercentage)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {dashboard.profitSharing.users.length === 0 ? (
            <div className="mt-6 rounded-xl bg-secondary/60 p-4">
              <p className="text-sm text-muted-foreground">No hay usuarios participantes en el reparto todavía.</p>
            </div>
          ) : (
            <div className="mt-6 overflow-x-auto">
              <table className="min-w-full border-separate border-spacing-y-2 text-sm">
                <thead>
                  <tr className="text-[11px] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                    <th className="px-3 py-2 text-left">Usuario</th>
                    <th className="px-3 py-2 text-right">Config. entradas %</th>
                    <th className="px-3 py-2 text-right">Config. consumibles %</th>
                    <th className="px-3 py-2 text-right">Ganancia entradas</th>
                    <th className="px-3 py-2 text-right">Ganancia consumibles</th>
                  </tr>
                </thead>
                <tbody>
                  {dashboard.profitSharing.users.map((user) => (
                    <tr key={user.userId} className="superadmin-row-card align-top transition hover:bg-accent/35">
                      <td className="rounded-l-lg border-y border-l border-border/60 px-3 py-4">
                        <p className="font-semibold text-foreground">{user.nombre}</p>
                        <p className="text-xs text-muted-foreground">{getPlatformRoleLabel(user.roleSlug)}</p>
                      </td>
                      <td className="border-y border-border/60 px-3 py-4 font-mono tabular-nums text-right">{number(user.configuredShareByFlow.entradas)}%</td>
                      <td className="border-y border-border/60 px-3 py-4 font-mono tabular-nums text-right">{number(user.configuredShareByFlow.consumibles)}%</td>
                      <td className="border-y border-border/60 px-3 py-4 font-mono tabular-nums text-right">{money(user.effectiveRevenueByFlow.entradas)}</td>
                      <td className="rounded-r-lg border-y border-r border-border/60 px-3 py-4 font-mono tabular-nums text-right">{money(user.effectiveRevenueByFlow.consumibles)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </SuperAdminPanel>
      ) : (
        <SuperAdminPanel>
          <PanelHeading title="Reparto platform por flow" description="Vista compacta del reparto actual y su ganancia efectiva." />
          <div className="mt-6 flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 py-10 text-center">
            <Crown className="h-8 w-8 text-muted-foreground/40" aria-hidden />
            <p className="mt-3 text-sm font-medium text-foreground">Sin configuración de reparto activa aún</p>
            <p className="mt-1 text-xs text-muted-foreground">Cuando exista la primera allocation se activará el reparto automático.</p>
            <Button asChild variant="outline" className="mt-4 border-border/80 bg-transparent">
              <Link href="/super-admin/configuracion">Ir a configurar</Link>
            </Button>
          </div>
        </SuperAdminPanel>
      )}
    </div>
  )
}
