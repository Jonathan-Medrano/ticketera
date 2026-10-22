"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  EMPRESA_FLOWS,
  formatEmpresaFeeFlowLabel,
  normalizeEmpresaMarketplaceFeeByFlow,
  type EmpresaMarketplaceFeeContract,
} from "@/lib/empresa-fees"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import {
  formatMarketplaceFeeSummary,
  getSalesReadinessActionLabel,
  getSalesReadinessMessage,
  getSalesReadinessStatusLabel,
  type SalesReadinessReason,
  type SalesReadinessStatus,
} from "@/lib/tenant"
import { CheckCircle2, CreditCard, Link2, RefreshCcw, ShieldAlert, Unplug, Wallet } from "lucide-react"
import { formatDateTime } from "@/lib/format"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

function SectionCard({
  icon: Icon,
  title,
  subtitle,
  children,
}: {
  icon: React.ElementType
  title: string
  subtitle: string
  children: React.ReactNode
}) {
  return (
    <div className="bg-card rounded-2xl border border-border/60 p-5">
      <div className="mb-5 flex items-start gap-2.5">
        <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
        <div>
          <p className="text-[15px] font-semibold tracking-tight text-foreground">{title}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
        </div>
      </div>
      {children}
    </div>
  )
}

type DashboardSalesReadiness = {
  status: SalesReadinessStatus
  reason: SalesReadinessReason | null
  canSell: boolean
}

type DashboardPaymentAccount = {
  id: string
  provider: "mercadopago"
  status: "pending_validation" | "ready_to_sell" | "blocked"
  reason: SalesReadinessReason | null
  credentialLast4: string | null
  providerAccountLabel: string | null
  validatedAt: string | null
  blockedAt: string | null
  updatedAt: string
}

type CobrosMercadoPagoResource = {
  provider: "mercadopago"
  payment_account: DashboardPaymentAccount | null
  sales_readiness: DashboardSalesReadiness
} & EmpresaMarketplaceFeeContract

type OAuthFlash = {
  status?: string
  reason?: string
}

function getOauthBanner(flash?: OAuthFlash) {
  if (flash?.status === "connected") {
    return {
      tone: "success" as const,
      text: "Mercado Pago quedó conectado correctamente. Ya estamos usando la autorización segura de la empresa.",
    }
  }

  if (flash?.status === "error") {
    const reason = flash.reason
    return {
      tone: "error" as const,
      text:
        reason === "sin_permiso"
          ? "No tenés permiso para conectar Mercado Pago."
          : reason === "state_mismatch"
            ? "La validación de seguridad del OAuth no coincidió. Reintentá la conexión."
            : reason === "oauth_exchange_failed"
              ? "Mercado Pago no permitió completar la autorización. Reintentá la conexión."
              : `No se pudo completar la conexión con Mercado Pago${reason ? ` (${reason})` : ""}. Reintentá; si persiste, contactá a soporte con ese código.`,
    }
  }

  return null
}

export default function CobrosContent({
  initialData,
  permisos,
  esEmpleado,
  loadError,
  oauthFlash,
}: {
  initialData: CobrosMercadoPagoResource
  permisos?: Permisos
  esEmpleado?: boolean
  loadError?: string
  oauthFlash?: OAuthFlash
}) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const canEdit = puede("editar_configuracion") && !loadError
  const router = useRouter()
  const { withLoading } = useLoading()
  const [resource, setResource] = useState(initialData)
  const [showDisconnectDialog, setShowDisconnectDialog] = useState(false)
  const marketplaceFeeByFlow = normalizeEmpresaMarketplaceFeeByFlow(resource)

  const readinessVariant = resource.sales_readiness.status === "ready_to_sell"
    ? "default"
    : resource.sales_readiness.status === "blocked"
      ? "destructive"
      : "secondary"

  const oauthBanner = useMemo(() => getOauthBanner(oauthFlash), [oauthFlash])

  async function refreshCobrosState() {
    const res = await fetch("/api/cobros/mercadopago", { method: "GET" })
    const data = await res.json()

    if (!res.ok) {
      throw new Error(data.error ?? "No se pudo refrescar la configuración de cobros")
    }

    setResource(data.data)
    router.refresh()
  }

  async function handleConnect() {
    await withLoading(async () => {
      try {
        const res = await fetch("/api/cobros/mercadopago/oauth/start", { method: "POST" })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || !(data as { authUrl?: string }).authUrl) {
          toast.error((data as { error?: string }).error ?? "No se pudo iniciar la conexión con Mercado Pago")
          return
        }

        window.location.assign((data as { authUrl: string }).authUrl)
      } catch {
        toast.error("No se pudo iniciar la conexión con Mercado Pago")
      }
    })
  }

  async function handleDisconnect() {
    await withLoading(async () => {
      try {
        const res = await fetch("/api/cobros/mercadopago", { method: "DELETE" })
        const data = await res.json().catch(() => ({}))

        if (!res.ok) {
          toast.error((data as { error?: string }).error ?? "No se pudo desconectar Mercado Pago")
          return
        }

        setResource(data.data)
        toast.success("Mercado Pago quedó desconectado")
        router.refresh()
      } catch {
        toast.error("No se pudo desconectar Mercado Pago")
      }
    })
  }

  async function handleRefresh() {
    await withLoading(async () => {
      try {
        await refreshCobrosState()
        toast.success("Estado de cobros actualizado")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo actualizar el estado")
      }
    })
  }

  return (
    <div className="space-y-5 pb-8">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Cobros</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Conectá la cuenta Mercado Pago de la empresa. La comisión marketplace la define Ticketera y se aplica automáticamente.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button type="button" variant="outline" className="h-10 gap-2" onClick={handleRefresh} disabled={!!loadError}>
            <RefreshCcw className="h-4 w-4" /> Actualizar estado
          </Button>
        </div>
      </div>

      {oauthBanner ? (
        <div
          className={oauthBanner.tone === "success"
            ? "rounded-2xl border border-primary/20 bg-primary/5 p-3 text-sm text-primary"
            : "rounded-2xl border border-destructive/25 bg-destructive/5 p-3 text-sm text-destructive"}
        >
          {oauthBanner.text}
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudo cargar toda la configuración de cobros: {loadError}. Dejé la pantalla visible, pero bloqueé la edición hasta que vuelva el backend.
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[1.15fr_0.85fr]">
        <SectionCard
          icon={Wallet}
          title="Cuenta Mercado Pago"
          subtitle="La empresa autoriza su cuenta por OAuth. No necesitás pegar tokens manualmente."
        >
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={readinessVariant} className="rounded-md">{getSalesReadinessStatusLabel(resource.sales_readiness.status)}</Badge>
              <span className="text-xs text-muted-foreground">{getSalesReadinessActionLabel(resource.sales_readiness)}</span>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">
              {getSalesReadinessMessage(resource.sales_readiness, "dashboard")}
            </p>

            <div className="grid gap-3 md:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Cuenta conectada</p>
                <p className="mt-1 text-sm font-medium text-foreground">
                  {resource.payment_account?.providerAccountLabel ?? "Mercado Pago sin alias interno"}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Identificador protegido</p>
                <p className="mt-1 text-sm font-medium text-foreground font-mono tabular-nums">
                  {resource.payment_account?.credentialLast4 ?? "Sin cuenta conectada"}
                </p>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Última actualización</p>
                <p className="mt-1 text-sm font-medium text-foreground font-mono tabular-nums">
                  {resource.payment_account?.updatedAt
                    ? formatDateTime(resource.payment_account.updatedAt)
                    : "Todavía sin conexión"}
                </p>
              </div>
              <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
                <p className="text-xs text-muted-foreground">Validación exitosa</p>
                <p className="mt-1 text-sm font-medium text-foreground font-mono tabular-nums">
                  {resource.payment_account?.validatedAt
                    ? formatDateTime(resource.payment_account.validatedAt)
                    : "Pendiente"}
                </p>
              </div>
            </div>

            {!resource.payment_account && (
              <div className="rounded-xl border border-border/60 bg-muted/20 p-4 space-y-3">
                <p className="text-xs font-semibold text-foreground">Antes de conectar, necesitás:</p>
                <ol className="space-y-2">
                  <li className="flex gap-2.5 text-sm text-muted-foreground">
                    <span className="shrink-0 font-mono tabular-nums text-xs text-muted-foreground/70 mt-0.5 w-4">1.</span>
                    <span>Tener una cuenta de Mercado Pago como vendedor. Si no tenés, creala en mercadopago.com.ar antes de continuar.</span>
                  </li>
                  <li className="flex gap-2.5 text-sm text-muted-foreground">
                    <span className="shrink-0 font-mono tabular-nums text-xs text-muted-foreground/70 mt-0.5 w-4">2.</span>
                    <span>Asegurarte de que tu cuenta esté verificada con tu CUIT o CUIL.</span>
                  </li>
                  <li className="flex gap-2.5 text-sm text-muted-foreground">
                    <span className="shrink-0 font-mono tabular-nums text-xs text-muted-foreground/70 mt-0.5 w-4">3.</span>
                    <span>Hacer clic en "Conectar Mercado Pago" — te redirigimos para que autorices el acceso de forma segura.</span>
                  </li>
                </ol>
                <p className="text-xs text-muted-foreground border-t border-border/40 pt-2.5">
                  ¿Por qué necesitamos esto? Para que los pagos de tus compradores lleguen directamente a tu cuenta de Mercado Pago.
                </p>
              </div>
            )}

            <div className="flex gap-2 flex-wrap">
              <Button type="button" className="h-10 gap-2" onClick={handleConnect} disabled={!canEdit}>
                <Link2 className="h-4 w-4" />
                {resource.payment_account ? "Reconectar Mercado Pago" : "Conectar Mercado Pago"}
              </Button>
              <Button
                type="button"
                variant="outline"
                className="h-10 gap-2"
                onClick={() => setShowDisconnectDialog(true)}
                disabled={!canEdit || !resource.payment_account}
              >
                <Unplug className="h-4 w-4" /> Desconectar
              </Button>
            </div>
          </div>
        </SectionCard>

        <SectionCard icon={ShieldAlert} title="Readiness comercial" subtitle="Señal única que usa dashboard, backend y sitio público para permitir ventas">
          <div className="space-y-3">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Estado operativo</p>
              <p className="mt-1 text-sm font-medium text-foreground">{getSalesReadinessStatusLabel(resource.sales_readiness.status)}</p>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Impacto en checkout</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {resource.sales_readiness.canSell
                  ? "El comprador puede avanzar al checkout y pagar con Mercado Pago."
                  : "El comprador ve el catálogo, pero los CTAs de compra quedan deshabilitados."}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_0.9fr]">
        <SectionCard icon={CreditCard} title="Comisión marketplace" subtitle="La define Ticketera. La empresa la ve, pero no puede editarla.">
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              {EMPRESA_FLOWS.map((flow) => (
                <div key={flow} className="rounded-xl border border-border/60 bg-muted/30 p-3">
                  <p className="text-xs text-muted-foreground">{formatEmpresaFeeFlowLabel(flow)}</p>
                  <p className="mt-1 text-sm font-medium text-foreground font-mono tabular-nums">
                    {formatMarketplaceFeeSummary(marketplaceFeeByFlow[flow])}
                  </p>
                </div>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Estas comisiones se aplican automáticamente según el flow real del checkout y no forman parte de la configuración editable de la empresa.
            </p>
          </div>
        </SectionCard>

        <SectionCard icon={resource.sales_readiness.canSell ? CheckCircle2 : RefreshCcw} title="Resumen accionable" subtitle="Lo que necesita operación antes de habilitar ventas reales">
          <div className="space-y-3">
            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Conexión de cobro</p>
              <p className="mt-1 text-sm font-medium text-foreground">
                {resource.payment_account ? "La cuenta Mercado Pago está vinculada a la empresa." : "Todavía no hay una cuenta Mercado Pago conectada."}
              </p>
            </div>

            <div className="rounded-xl border border-border/60 bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground">Siguiente acción recomendada</p>
              <p className="mt-1 text-sm font-medium text-foreground">{getSalesReadinessActionLabel(resource.sales_readiness)}</p>
            </div>
          </div>
        </SectionCard>
      </div>

      <Dialog open={showDisconnectDialog} onOpenChange={(v) => { if (!v) setShowDisconnectDialog(false) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Desconectar Mercado Pago?</DialogTitle>
            <DialogDescription className="mt-1 text-sm text-muted-foreground">
              Si desconectás tu cuenta, los compradores no podrán pagar hasta que vuelvas a conectarla.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-4 flex gap-2">
            <Button variant="outline" className="flex-1 h-10" onClick={() => setShowDisconnectDialog(false)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              className="flex-1 h-10"
              onClick={() => {
                setShowDisconnectDialog(false)
                void handleDisconnect()
              }}
            >
              Desconectar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
