"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { useLoading } from "@/components/loading-provider"
import { buildOwnerPaymentUiModel, getOwnerOauthBanner, type OAuthFlash } from "@/components/super-admin/owner-payment-ui"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import type { PlatformFeeMode, PlatformFlow, PlatformOwnerPaymentAccount, PlatformProfitSharingCutoff, PlatformViewerScope } from "@/components/super-admin/types"
import { formatFeeSummary, formatFlowLabel, formatPlatformTimestamp, getFeeSourceLabel, getReadinessLabel, number } from "@/components/super-admin/utils"
import { HardDrive, KeyRound, Link2, RefreshCcw, ShieldAlert, Trash2, Unplug } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"

type DefaultsMap = Record<PlatformFlow, { mode: PlatformFeeMode; percentage: string; fixedAmount: string }>
type DefaultsFieldErrors = Record<PlatformFlow, { percentage: string | null; fixedAmount: string | null }>

function buildDefaultsForm(defaultsByFlow: Record<PlatformFlow, { mode: PlatformFeeMode | null; percentage: number | null; fixedAmount: number | null }>): DefaultsMap {
  return {
    entradas: {
      mode: defaultsByFlow.entradas.mode ?? "percentage",
      percentage: defaultsByFlow.entradas.percentage?.toString() ?? "",
      fixedAmount: defaultsByFlow.entradas.fixedAmount?.toString() ?? "",
    },
    consumibles: {
      mode: defaultsByFlow.consumibles.mode ?? "percentage",
      percentage: defaultsByFlow.consumibles.percentage?.toString() ?? "",
      fixedAmount: defaultsByFlow.consumibles.fixedAmount?.toString() ?? "",
    },
  }
}

// Mirrors backend policy (backend/src/lib/password-policy.ts) so the obvious violations surface
// before the round-trip. The server still re-validates on every request — this is UX only.
const PASSWORD_POLICY_SPECIAL_CHARS = `!"#$%&'()*+,-./:;<=>?@[\\]^_{|}~`
const passwordPolicySpecialCharSet = new Set(PASSWORD_POLICY_SPECIAL_CHARS.split(""))

function getPasswordPolicyError(password: string): string | null {
  if (!password.trim()) return "La contraseña no puede estar vacía"
  if (/\s/.test(password)) return "La contraseña no puede contener espacios"
  if (password.length < 12) return "La contraseña debe tener al menos 12 caracteres"
  if (!/[A-Z]/.test(password)) return "La contraseña debe incluir al menos una mayúscula"
  if (!/[a-z]/.test(password)) return "La contraseña debe incluir al menos una minúscula"
  if (!/[0-9]/.test(password)) return "La contraseña debe incluir al menos un número"
  if (!password.split("").some((char) => passwordPolicySpecialCharSet.has(char))) {
    return "La contraseña debe incluir al menos un carácter especial"
  }
  return null
}

// Mirrors backend range validation (backend/src/lib/marketplace-fee.ts:validateMarketplaceFeeConfig):
// percentage must be within 0-100, fixedAmount must be >= 0 (no upper cap). Empty string is valid
// (clears the field to null). Keeping this permissive by design — the platform-wide fee default is
// sensitive, so we only block clearly-invalid numeric input, never a value the backend would accept.
function validateFeeField(field: "percentage" | "fixedAmount", raw: string): string | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const parsed = Number(trimmed.replace(",", "."))
  if (!Number.isFinite(parsed)) return "Ingresá un número válido"
  if (field === "percentage") {
    if (parsed < 0 || parsed > 100) return "Debe estar entre 0 y 100"
  } else if (parsed < 0) {
    return "No puede ser negativo"
  }
  return null
}

// Same comma-to-dot normalization as validateFeeField, so what gets validated is exactly what
// gets sent — avoids AR-locale decimals ("4,5") silently turning into NaN → null on submit.
function parseFeeField(raw: string): number | null {
  const trimmed = raw.trim()
  if (trimmed === "") return null
  const parsed = Number(trimmed.replace(",", "."))
  return Number.isFinite(parsed) ? parsed : null
}

export default function ConfiguracionSection({
  initialDefaultsByFlow,
  initialOwnerPaymentAccount,
  initialCurrentUserPaymentAccount,
  initialProfitSharingCutoff,
  canManageSingletonOnly,
  viewerScope,
  oauthFlash,
}: {
  initialDefaultsByFlow: Record<PlatformFlow, { mode: PlatformFeeMode | null; percentage: number | null; fixedAmount: number | null; configured: boolean; source: "global" | "empresa" | null; legacyFallback: "empresa_legacy" | "env_legacy" | null; flow: PlatformFlow }>
  initialOwnerPaymentAccount: PlatformOwnerPaymentAccount
  initialCurrentUserPaymentAccount?: PlatformOwnerPaymentAccount
  initialProfitSharingCutoff: PlatformProfitSharingCutoff
  canManageSingletonOnly: boolean
  viewerScope?: PlatformViewerScope
  oauthFlash?: OAuthFlash
}) {
  const router = useRouter()
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme
  const dialogClassName = "bg-card border-border text-foreground shadow-[var(--superadmin-soft-shadow)]"
  const [defaultsByFlow, setDefaultsByFlow] = useState(initialDefaultsByFlow)
  const [defaultsForm, setDefaultsForm] = useState(buildDefaultsForm(initialDefaultsByFlow))
  const [defaultsFieldErrors, setDefaultsFieldErrors] = useState<DefaultsFieldErrors>({
    entradas: { percentage: null, fixedAmount: null },
    consumibles: { percentage: null, fixedAmount: null },
  })
  const [ownerPayment, setOwnerPayment] = useState(initialOwnerPaymentAccount)
  const [currentUserPayment, setCurrentUserPayment] = useState(initialCurrentUserPaymentAccount ?? null)
  const [storageCleanupCooldown, setStorageCleanupCooldown] = useState("24")
  const [storageCleanupDryRun, setStorageCleanupDryRun] = useState(true)
  const [storageCleanupRunning, setStorageCleanupRunning] = useState(false)
  const [storageCleanupShowOrphans, setStorageCleanupShowOrphans] = useState(false)
  const [storageCleanupResult, setStorageCleanupResult] = useState<{
    status: "ok" | "skipped"
    reason?: string
    scanned: number
    inUse: number
    withinCooldown: number
    orphans: number
    deleted: number
    failed: number
    dryRun: boolean
    orphanSample: Array<{ path: string; createdAt: string | null; sizeBytes: number | null }>
    runId: number | null
  } | null>(null)
  const [storageCleanupHistory, setStorageCleanupHistory] = useState<
    Array<{
      id: number
      started_at: string
      finished_at: string
      duration_ms: number
      scanned: number
      in_use: number
      within_cooldown: number
      orphans: number
      deleted: number
      failed: number
      cooldown_hours: number
      dry_run: 0 | 1
      triggered_by: "cron" | "manual"
      triggered_by_user_id: string | null
      triggered_by_user_name: string | null
      status: string
      reason: string | null
    }>
  >([])
  const [storageCleanupHistoryLoading, setStorageCleanupHistoryLoading] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ label: string; description: string; onConfirm: () => Promise<void> } | null>(null)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" })

  const oauthBanner = useMemo(() => getOwnerOauthBanner(oauthFlash), [oauthFlash])
  const ownerPaymentUi = useMemo(() => buildOwnerPaymentUiModel(ownerPayment), [ownerPayment])
  const currentUserPaymentUi = useMemo(() => buildOwnerPaymentUiModel(currentUserPayment), [currentUserPayment])
  const isGlobalViewer = viewerScope === "global" || !viewerScope
  const accountCard = isGlobalViewer ? ownerPayment : currentUserPayment
  const accountUi = isGlobalViewer ? ownerPaymentUi : currentUserPaymentUi
  const lastRun = storageCleanupHistory[0] ?? null

  async function updateDefault(flow: PlatformFlow) {
    const form = defaultsForm[flow]
    const percentageError = validateFeeField("percentage", form.percentage)
    const fixedAmountError = validateFeeField("fixedAmount", form.fixedAmount)
    setDefaultsFieldErrors((prev) => ({ ...prev, [flow]: { percentage: percentageError, fixedAmount: fixedAmountError } }))
    if (percentageError || fixedAmountError) {
      toast.error("Revisá el porcentaje y el monto fijo antes de guardar el default global")
      return
    }

    setPendingAction({
      label: "Cambiar fee global",
      description: `Vas a modificar el fee global para el flow "${formatFlowLabel(flow)}". Este cambio afecta la liquidación de TODAS las empresas que no tienen override propio.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const form = defaultsForm[flow]
          const res = await fetch("/api/platform/configuracion/fees", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flow,
              mode: form.mode,
              percentage: parseFeeField(form.percentage),
              fixedAmount: parseFeeField(form.fixedAmount),
            }),
          })
          const data = (await res.json()) as { data?: { defaultsByFlow: typeof initialDefaultsByFlow }; error?: string }
          if (!res.ok || !data.data) {
            toast.error(data.error ?? "No se pudo actualizar el default global")
            return
          }
          setDefaultsByFlow(data.data.defaultsByFlow)
          setDefaultsForm(buildDefaultsForm(data.data.defaultsByFlow))
          toast.success(`Default global de ${formatFlowLabel(flow).toLowerCase()} actualizado`)
        })
      },
    })
  }

  async function refreshOwnerPaymentAccount() {
    const res = await fetch("/api/platform/cobros/mercadopago", { method: "GET" })
    const data = (await res.json()) as { data?: { ownerPaymentAccount?: PlatformOwnerPaymentAccount; currentUserPaymentAccount?: PlatformOwnerPaymentAccount }; error?: string }

    if (!res.ok || !data.data) {
      throw new Error(data.error ?? "No se pudo refrescar la cuenta platform")
    }

    setOwnerPayment(data.data.ownerPaymentAccount ?? null)
    setCurrentUserPayment(data.data.currentUserPaymentAccount ?? null)
    router.refresh()
  }

  async function handleConnectOwnerPaymentAccount() {
    await withLoading(async () => {
      const res = await fetch("/api/platform/cobros/mercadopago/oauth/start", { method: "POST" })
      const data = (await res.json()) as { authUrl?: string; error?: string }

      if (!res.ok || !data.authUrl) {
        toast.error(data.error ?? "No se pudo iniciar la conexión owner con Mercado Pago")
        return
      }

      window.location.assign(data.authUrl)
    })
  }

  async function handleDisconnectOwnerPaymentAccount() {
    await withLoading(async () => {
      const res = await fetch("/api/platform/cobros/mercadopago", { method: "DELETE" })
      const data = (await res.json()) as { data?: PlatformOwnerPaymentAccount; error?: string }

      if (!res.ok || typeof data.data === "undefined") {
        toast.error(data.error ?? "No se pudo desconectar Mercado Pago owner")
        return
      }

      setOwnerPayment(data.data)
      toast.success("Mercado Pago owner quedó desconectado")
      router.refresh()
    })
  }

  const loadStorageCleanupHistory = useCallback(async () => {
    setStorageCleanupHistoryLoading(true)
    try {
      const res = await fetch("/api/platform/storage/cleanup-history")
      if (!res.ok) return
      const data = (await res.json()) as { data?: { runs: typeof storageCleanupHistory } }
      if (data.data?.runs) {
        setStorageCleanupHistory(data.data.runs)
      }
    } catch {
      // silencioso — el historial es opcional
    } finally {
      setStorageCleanupHistoryLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStorageCleanupHistory()
  }, [loadStorageCleanupHistory])

  async function handleStorageCleanup() {
    if (storageCleanupRunning) return

    const cooldownNum = Number(storageCleanupCooldown)
    if (!Number.isFinite(cooldownNum) || cooldownNum < 0) {
      toast.error("Cooldown inválido — usá un número entero >= 0")
      return
    }

    if (!storageCleanupDryRun) {
      setPendingAction({
        label: "Ejecutar limpieza de storage",
        description: "Vas a BORRAR los archivos huerfanos de Supabase Storage. Esta accion es irreversible. Asegurate de haber revisado el dry-run primero.",
        onConfirm: async () => {
          setStorageCleanupRunning(true)
          setStorageCleanupResult(null)
          try {
            const res = await fetch("/api/platform/storage/orphan-cleanup", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                dryRun: false,
                cooldownHours: cooldownNum,
              }),
            })
            const data = (await res.json()) as { data?: typeof storageCleanupResult; error?: string }
            if (!res.ok || !data.data) {
              toast.error(data.error ?? "No se pudo ejecutar la limpieza")
              return
            }
            setStorageCleanupResult(data.data)
            setStorageCleanupShowOrphans(false)
            if (data.data.status === "skipped") {
              toast.warning(`Limpieza omitida: ${data.data.reason ?? "razón desconocida"}`)
            } else {
              toast.success(`Limpieza ejecutada: ${data.data.deleted} archivo(s) borrado(s).`)
            }
            void loadStorageCleanupHistory()
          } catch {
            toast.error("Error de red — no se pudo contactar al backend")
          } finally {
            setStorageCleanupRunning(false)
          }
        },
      })
      return
    }

    setStorageCleanupRunning(true)
    setStorageCleanupResult(null)
    try {
      const res = await fetch("/api/platform/storage/orphan-cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dryRun: true,
          cooldownHours: cooldownNum,
        }),
      })
      const data = (await res.json()) as { data?: typeof storageCleanupResult; error?: string }
      if (!res.ok || !data.data) {
        toast.error(data.error ?? "No se pudo ejecutar la limpieza")
        return
      }
      setStorageCleanupResult(data.data)
      setStorageCleanupShowOrphans(false)
      if (data.data.status === "skipped") {
        toast.warning(`Limpieza omitida: ${data.data.reason ?? "razón desconocida"}`)
      } else {
        toast.success(`Dry-run completo. ${data.data.orphans} archivo(s) huérfano(s) detectado(s).`)
      }
      void loadStorageCleanupHistory()
    } catch {
      toast.error("Error de red — no se pudo contactar al backend")
    } finally {
      setStorageCleanupRunning(false)
    }
  }

  function formatBytesShort(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return "—"
    if (value < 1024) return `${value} B`
    if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
    return `${(value / (1024 * 1024)).toFixed(1)} MB`
  }

  function formatDurationShort(ms: number): string {
    if (ms < 1000) return `${ms}ms`
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
    return `${Math.floor(ms / 60_000)}m ${Math.round((ms % 60_000) / 1000)}s`
  }

  async function handleRefreshOwnerPaymentAccount() {
    await withLoading(async () => {
      try {
        await refreshOwnerPaymentAccount()
        toast.success("Estado owner actualizado")
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "No se pudo actualizar el estado owner")
      }
    })
  }

  async function changePassword() {
    const { currentPassword, newPassword, confirmPassword } = passwordForm
    if (!currentPassword || !newPassword || !confirmPassword) {
      toast.error("Completá todos los campos")
      return
    }
    if (newPassword !== confirmPassword) {
      toast.error("Las contraseñas nuevas no coinciden")
      return
    }
    const policyError = getPasswordPolicyError(newPassword)
    if (policyError) {
      toast.error(policyError)
      return
    }
    await withLoading(async () => {
      const res = await fetch("/api/platform/me/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword, confirmPassword }),
      })
      const data = (await res.json()) as { data?: { ok: boolean }; error?: string; details?: { message?: string } }
      if (!res.ok) {
        toast.error(data.details?.message ?? data.error ?? "Error al cambiar la contraseña")
        return
      }
      setPasswordForm({ currentPassword: "", newPassword: "", confirmPassword: "" })
      toast.success("Contraseña actualizada. Tu sesión seguirá activa.")
    })
  }

  return (
    <div className="space-y-6">
      {/* 1. Read-mode warning banner */}
      {!canManageSingletonOnly ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
          Estás viendo la configuración en modo lectura. Esta pestaña prioriza capabilities explícitas sobre hacks por página.
        </div>
      ) : null}

      {/* 2. OAuth flash banner */}
      {oauthBanner ? (
        <div data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope">
          <div
            className={oauthBanner.tone === "success"
              ? "rounded-2xl border border-success/30 bg-success/8 px-4 py-3 text-sm text-success"
              : "rounded-2xl border border-destructive/30 bg-destructive/8 px-4 py-3 text-sm text-destructive"}
          >
            {oauthBanner.text}
          </div>
        </div>
      ) : null}

      {/* 3. KPI strip */}
      <SuperAdminPanel>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-4">
          {/* Fee Entradas */}
          <SAKpiCard tone="neutral">
            <p className={saKpiLabelCn}>Fee Entradas</p>
            <p className="mt-1.5 font-mono text-xl font-semibold text-foreground tabular-nums">
              {formatFeeSummary(defaultsByFlow.entradas)}
            </p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              {!defaultsByFlow.entradas.configured && (
                <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                  Sin configurar
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{getFeeSourceLabel(defaultsByFlow.entradas)}</span>
            </div>
          </SAKpiCard>

          {/* Fee Consumibles */}
          <SAKpiCard tone="neutral">
            <p className={saKpiLabelCn}>Fee Consumibles</p>
            <p className="mt-1.5 font-mono text-xl font-semibold text-foreground tabular-nums">
              {formatFeeSummary(defaultsByFlow.consumibles)}
            </p>
            <div className="mt-1 flex items-center gap-1.5 flex-wrap">
              {!defaultsByFlow.consumibles.configured && (
                <Badge variant="outline" className="text-[10px] text-warning border-warning/30">
                  Sin configurar
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">{getFeeSourceLabel(defaultsByFlow.consumibles)}</span>
            </div>
          </SAKpiCard>

          {/* Cuenta MP Owner */}
          <div data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope">
            <SAKpiCard tone="neutral">
              <p className={saKpiLabelCn}>Cuenta MP Owner</p>
              <div className="mt-1.5 flex items-center gap-2">
                <span
                  className={cn(
                    "inline-block h-2 w-2 shrink-0 rounded-full",
                    ownerPayment?.status === "ready_to_sell"
                      ? "bg-success"
                      : "bg-warning",
                  )}
                />
                <p className="text-sm font-semibold text-foreground leading-tight">
                  {getReadinessLabel(ownerPayment ? { status: ownerPayment.status, reason: ownerPayment.reason, canSell: ownerPayment.status === "ready_to_sell" } : null)}
                </p>
              </div>
              <span className="mt-1 block text-xs text-muted-foreground">{accountUi.connectionModeLabel}</span>
            </SAKpiCard>
          </div>

          {/* Ultimo cleanup */}
          <SAKpiCard tone="neutral">
            <p className={saKpiLabelCn}>Ultimo cleanup</p>
            <p className="mt-1.5 text-sm font-semibold text-foreground">
              {formatPlatformTimestamp(lastRun?.started_at, "Nunca")}
            </p>
            <span className="mt-1 block text-xs text-muted-foreground">
              {lastRun
                ? `${lastRun.orphans} huerf. · ${lastRun.dry_run ? "dry-run" : "real"}`
                : "Sin corridas"}
            </span>
          </SAKpiCard>
        </div>
      </SuperAdminPanel>

      {/* 4. Password change panel */}
      {canManageSingletonOnly && (
        <SuperAdminPanel>
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-muted/50 p-2.5">
              <KeyRound className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground">Cambiar contraseña</p>
              <p className="text-xs text-muted-foreground">Actualiza la contraseña de tu cuenta superadmin.</p>
            </div>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            <div>
              <Label className="text-xs text-muted-foreground">Contraseña actual</Label>
              <Input
                type="password"
                className="mt-1 h-10 border-input bg-background text-foreground"
                value={passwordForm.currentPassword}
                onChange={(e) => setPasswordForm((p) => ({ ...p, currentPassword: e.target.value }))}
                placeholder="••••••••••••"
                autoComplete="current-password"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Nueva contraseña</Label>
              <Input
                type="password"
                className="mt-1 h-10 border-input bg-background text-foreground"
                value={passwordForm.newPassword}
                onChange={(e) => setPasswordForm((p) => ({ ...p, newPassword: e.target.value }))}
                placeholder="Mín. 12 caracteres"
                autoComplete="new-password"
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Confirmar nueva contraseña</Label>
              <Input
                type="password"
                className="mt-1 h-10 border-input bg-background text-foreground"
                value={passwordForm.confirmPassword}
                onChange={(e) => setPasswordForm((p) => ({ ...p, confirmPassword: e.target.value }))}
                placeholder="••••••••••••"
                autoComplete="new-password"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <Button
              className="bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => void changePassword()}
            >
              Cambiar contraseña
            </Button>
            <p className="text-xs text-muted-foreground">
              Política: mín. 12 caracteres, mayúscula, minúscula, número y carácter especial.
            </p>
          </div>
        </SuperAdminPanel>
      )}

      {/* 5. Profit sharing cutoff info row */}
      <div className="rounded-2xl border border-border/25 bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        {initialProfitSharingCutoff.startsAt
          ? `Corte activo profit sharing: ${formatPlatformTimestamp(initialProfitSharingCutoff.startsAt, "Pendiente")}. El histórico anterior NO se reparte ni se backfillea.`
          : "Todavía no existe un corte activo profit sharing. Cuando aparezca la primera allocation nueva, ese momento va a definir desde cuándo aplican los números sin tocar histórico previo."}
      </div>

      {/* 6. Two-column grid — fee defaults + MP account */}
      <div className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <SuperAdminPanel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">Defaults globales por flow</p>
              <p className="text-xs text-muted-foreground">Política platform aplicada cuando una empresa no tiene override.</p>
            </div>
            <Badge variant="secondary">Capability-driven</Badge>
          </div>

          <div className="mt-5 grid gap-4">
            {(["entradas", "consumibles"] as const).map((flow) => (
              <div key={flow} className="rounded-2xl border border-border/30 bg-muted/30 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-semibold text-foreground">{formatFlowLabel(flow)}</p>
                    <p className="mt-1 text-xs text-muted-foreground">Actual: {formatFeeSummary(defaultsByFlow[flow])} · {getFeeSourceLabel(defaultsByFlow[flow])}</p>
                  </div>
                </div>

                <div className="mt-4 space-y-4">
                  <div>
                    <Label htmlFor={`cfg-modo-${flow}`} className="text-xs text-muted-foreground">Modo</Label>
                    <select
                      id={`cfg-modo-${flow}`}
                      disabled={!canManageSingletonOnly}
                      className="mt-1 h-10 w-full rounded-xl border border-input bg-background px-3 text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                      value={defaultsForm[flow].mode}
                      onChange={(e) => setDefaultsForm((prev) => ({ ...prev, [flow]: { ...prev[flow], mode: e.target.value as PlatformFeeMode } }))}
                    >
                      <option value="percentage">Porcentaje</option>
                      <option value="fixed">Monto fijo</option>
                      <option value="hybrid">Híbrida</option>
                    </select>
                  </div>
                  <div>
                    <Label htmlFor={`cfg-pct-${flow}`} className="text-xs text-muted-foreground">Porcentaje</Label>
                    <Input
                      id={`cfg-pct-${flow}`}
                      type="text"
                      inputMode="decimal"
                      disabled={!canManageSingletonOnly}
                      aria-invalid={Boolean(defaultsFieldErrors[flow].percentage)}
                      className="mt-1 h-10 border-input bg-background text-foreground disabled:opacity-60"
                      value={defaultsForm[flow].percentage}
                      onChange={(e) => {
                        const val = e.target.value
                        setDefaultsForm((prev) => ({ ...prev, [flow]: { ...prev[flow], percentage: val } }))
                        setDefaultsFieldErrors((prev) => ({ ...prev, [flow]: { ...prev[flow], percentage: validateFeeField("percentage", val) } }))
                      }}
                      placeholder="4"
                    />
                    {defaultsFieldErrors[flow].percentage ? (
                      <p className="mt-1 text-xs text-destructive">{defaultsFieldErrors[flow].percentage}</p>
                    ) : null}
                  </div>
                  <div>
                    <Label htmlFor={`cfg-fixed-${flow}`} className="text-xs text-muted-foreground">Monto fijo</Label>
                    <Input
                      id={`cfg-fixed-${flow}`}
                      type="text"
                      inputMode="decimal"
                      disabled={!canManageSingletonOnly}
                      aria-invalid={Boolean(defaultsFieldErrors[flow].fixedAmount)}
                      className="mt-1 h-10 border-input bg-background text-foreground disabled:opacity-60"
                      value={defaultsForm[flow].fixedAmount}
                      onChange={(e) => {
                        const val = e.target.value
                        setDefaultsForm((prev) => ({ ...prev, [flow]: { ...prev[flow], fixedAmount: val } }))
                        setDefaultsFieldErrors((prev) => ({ ...prev, [flow]: { ...prev[flow], fixedAmount: validateFeeField("fixedAmount", val) } }))
                      }}
                      placeholder="0"
                    />
                    {defaultsFieldErrors[flow].fixedAmount ? (
                      <p className="mt-1 text-xs text-destructive">{defaultsFieldErrors[flow].fixedAmount}</p>
                    ) : null}
                  </div>
                  <Button
                    disabled={!canManageSingletonOnly || Boolean(defaultsFieldErrors[flow].percentage) || Boolean(defaultsFieldErrors[flow].fixedAmount)}
                    className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
                    onClick={() => updateDefault(flow)}
                  >
                    Guardar default de {formatFlowLabel(flow).toLowerCase()}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </SuperAdminPanel>

        <SuperAdminPanel>
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-semibold text-foreground">{isGlobalViewer ? "Cuenta Mercado Pago del owner" : "Tu cuenta Mercado Pago"}</p>
              <p className="text-xs text-muted-foreground">{isGlobalViewer ? "Aislada de los sellers tenant y conectada por OAuth. La carga manual dejó de ser el camino principal." : "Tu cuenta personal de payout dentro de la consola platform, conectada por OAuth."}</p>
            </div>
            <Badge variant="secondary">{isGlobalViewer ? "Vista global" : "Vista personal"}</Badge>
          </div>

          <div className="mt-5 space-y-4">
            {accountUi.showLegacyManualBanner ? (
              <div className="rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
                Hay una credencial legacy manual todavía visible en el read model. Podés reconectarla por OAuth para dejar la cuenta alineada al flujo nuevo.
              </div>
            ) : null}

            <div className="rounded-2xl border border-border/25 bg-muted/40 px-4 py-3">
              <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Estado</p>
              <p className="mt-2 text-sm font-semibold text-foreground">{accountCard ? getReadinessLabel({ status: accountCard.status, reason: accountCard.reason, canSell: accountCard.status === "ready_to_sell" }) : "Sin cuenta cargada"}</p>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label className="text-xs text-muted-foreground">Cuenta conectada</Label>
                <Input className="mt-1 h-10 border-input bg-background text-foreground" readOnly value={accountCard?.providerAccountLabel ?? "Sin cuenta conectada"} />
              </div>
              <div>
                <Label className="text-xs text-muted-foreground">Identificador protegido</Label>
                <Input className="mt-1 h-10 border-input bg-background font-mono text-foreground" readOnly value={accountCard?.credentialLast4 ?? "Sin credencial"} />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">Modo de conexión</p>
                <p className="mt-1 text-sm font-medium text-foreground">{accountUi.connectionModeLabel}</p>
              </div>
              <div className="rounded-2xl border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">OAuth conectado</p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatPlatformTimestamp(accountCard?.oauthConnectedAt, "Pendiente")}</p>
              </div>
              <div className="rounded-2xl border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">Validación exitosa</p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatPlatformTimestamp(accountCard?.validatedAt, "Pendiente")}</p>
              </div>
              <div className="rounded-2xl border border-border px-4 py-3">
                <p className="text-xs text-muted-foreground">Última actualización</p>
                <p className="mt-1 text-sm font-medium text-foreground">{formatPlatformTimestamp(accountCard?.updatedAt, "Todavía sin conexión")}</p>
              </div>
            </div>

            <div className="rounded-2xl border border-border/25 bg-muted/30 px-4 py-3">
              <div className="flex items-start gap-3">
                <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <p className="text-sm text-muted-foreground">
                  {isGlobalViewer
                    ? "La cuenta owner ahora se administra con OAuth. La UI conserva compatibilidad con el read model de dashboard y health, pero deja de promover carga manual de credenciales."
                    : "Tu cuenta de payout dentro de la consola platform usa OAuth. La UI mantiene el flujo alineado con el read model backend sin volver a promover cargas manuales."}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button disabled={!canManageSingletonOnly} className="gap-2 bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground" onClick={handleConnectOwnerPaymentAccount}>
                <Link2 className="h-4 w-4" />
                {ownerPaymentUi.primaryAction.label}
              </Button>
              <Button type="button" variant="outline" className="gap-2" onClick={handleRefreshOwnerPaymentAccount}>
                <RefreshCcw className="h-4 w-4" /> Actualizar estado
              </Button>
              <Button
                type="button"
                variant="outline"
                className="gap-2"
                onClick={() => setPendingAction({
                  label: "Desconectar Mercado Pago",
                  description: "Vas a desconectar la cuenta owner de Mercado Pago. Las empresas que dependan del payout owner van a quedar sin cuenta activa hasta que reconectes.",
                  onConfirm: handleDisconnectOwnerPaymentAccount,
                })}
                disabled={!canManageSingletonOnly || !accountCard}
              >
                <Unplug className="h-4 w-4" /> Desconectar
              </Button>
            </div>
          </div>
        </SuperAdminPanel>
      </div>

      {/* 7. Storage cleanup controls panel */}
      <SuperAdminPanel>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3">
            <div className="rounded-2xl bg-muted/50 p-2.5">
              <HardDrive className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <p className="font-semibold text-foreground">Limpieza de archivos huérfanos</p>
              <p className="text-xs text-muted-foreground max-w-xl">
                Borra imágenes en Supabase Storage que ya NO están referenciadas en la base de datos.
                Empezá siempre con dry-run para inspeccionar antes de borrar.
              </p>
            </div>
          </div>
          <Badge variant="secondary">Job: cada 24hs</Badge>
        </div>

        <div className="mt-5 grid gap-4 sm:grid-cols-[180px_1fr_auto] sm:items-end">
          <div>
            <Label className="text-xs text-muted-foreground">Cooldown (horas)</Label>
            <Input
              type="number"
              min="0"
              className="mt-1 h-10 border-input bg-background text-foreground"
              value={storageCleanupCooldown}
              onChange={(e) => setStorageCleanupCooldown(e.target.value)}
              disabled={storageCleanupRunning}
              placeholder="24"
            />
            <p className="mt-1 text-[11px] text-muted-foreground">
              Archivos más nuevos que esto se ignoran (protege uploads en formularios sin guardar)
            </p>
          </div>
          <label className="flex h-10 items-center gap-3 rounded-xl border border-input bg-background px-3 cursor-pointer">
            <Checkbox
              checked={storageCleanupDryRun}
              onCheckedChange={(v) => setStorageCleanupDryRun(!!v)}
              disabled={storageCleanupRunning}
            />
            <span className="text-sm font-medium text-foreground">
              Dry-run (no borra, solo reporta)
            </span>
          </label>
          <Button
            type="button"
            className="gap-2 h-11"
            variant={storageCleanupDryRun ? "outline" : "default"}
            onClick={() => void handleStorageCleanup()}
            disabled={storageCleanupRunning || !canManageSingletonOnly}
          >
            {storageCleanupDryRun ? <HardDrive className="h-4 w-4" /> : <Trash2 className="h-4 w-4" />}
            {storageCleanupRunning ? "Ejecutando..." : storageCleanupDryRun ? "Simular" : "Ejecutar limpieza"}
          </Button>
        </div>

        {storageCleanupResult ? (
          <div data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope mt-5 space-y-3">
            {storageCleanupResult.status === "skipped" ? (
              <div className="rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
                Limpieza omitida — <span className="font-mono">{storageCleanupResult.reason ?? "razón desconocida"}</span>.
                Probablemente faltan <span className="font-mono">SUPABASE_URL</span> o <span className="font-mono">SUPABASE_SERVICE_ROLE_KEY</span> en el .env del backend.
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge variant={storageCleanupResult.dryRun ? "outline" : "default"}>
                    {storageCleanupResult.dryRun ? "Dry-run" : "Ejecutado"}
                  </Badge>
                  <span>Última corrida</span>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                  <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Escaneados</p>
                    <p className="mt-0.5 text-lg font-semibold text-foreground">{storageCleanupResult.scanned}</p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">En uso</p>
                    <p className="mt-0.5 text-lg font-semibold text-success">{storageCleanupResult.inUse}</p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">En cooldown</p>
                    <p className="mt-0.5 text-lg font-semibold text-primary">{storageCleanupResult.withinCooldown}</p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Huérfanos</p>
                    <p className="mt-0.5 text-lg font-semibold text-warning">{storageCleanupResult.orphans}</p>
                  </div>
                  <div className="rounded-2xl border border-border/50 bg-muted/30 px-3 py-2.5">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      {storageCleanupResult.dryRun ? "Borrarían" : "Borrados"}
                    </p>
                    <p className="mt-0.5 text-lg font-semibold text-foreground">
                      {storageCleanupResult.dryRun ? storageCleanupResult.orphans : storageCleanupResult.deleted}
                      {storageCleanupResult.failed > 0 ? (
                        <span className="ml-1 text-xs font-normal text-destructive">/ {storageCleanupResult.failed} fail</span>
                      ) : null}
                    </p>
                  </div>
                </div>

                {storageCleanupResult.orphanSample.length > 0 ? (
                  <div className="mt-2">
                    <button
                      type="button"
                      onClick={() => setStorageCleanupShowOrphans((v) => !v)}
                      className="text-xs font-medium text-foreground/80 hover:text-foreground underline-offset-2 hover:underline"
                    >
                      {storageCleanupShowOrphans
                        ? "Ocultar paths huérfanos"
                        : `Ver paths huérfanos detectados (${storageCleanupResult.orphanSample.length}${storageCleanupResult.orphans > storageCleanupResult.orphanSample.length ? ` de ${storageCleanupResult.orphans}` : ""})`}
                    </button>
                    {storageCleanupShowOrphans ? (
                      <div className="mt-2 overflow-x-auto rounded-2xl border border-border/50">
                        <table className="min-w-full divide-y divide-border/40 text-xs">
                          <thead className="bg-muted/40">
                            <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                              <th className="px-3 py-2 font-medium">Path</th>
                              <th className="px-3 py-2 font-medium">Tamaño</th>
                              <th className="px-3 py-2 font-medium">Creado</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border/30">
                            {storageCleanupResult.orphanSample.map((orphan) => (
                              <tr key={orphan.path} className="hover:bg-muted/20">
                                <td className="px-3 py-1.5 font-mono text-[11px] text-foreground/90 break-all">{orphan.path}</td>
                                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">{formatBytesShort(orphan.sizeBytes)}</td>
                                <td className="px-3 py-1.5 text-muted-foreground whitespace-nowrap">
                                  {orphan.createdAt ? formatPlatformTimestamp(orphan.createdAt, "—") : "—"}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {storageCleanupResult.orphans > storageCleanupResult.orphanSample.length ? (
                          <p className="px-3 py-2 text-[11px] text-muted-foreground bg-muted/20">
                            Mostrando primeros {storageCleanupResult.orphanSample.length} de {storageCleanupResult.orphans} huérfanos (los más viejos).
                          </p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ) : null}
      </SuperAdminPanel>

      {/* 8. Storage cleanup history table */}
      <SuperAdminPanel>
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <p className="font-semibold text-foreground">Historial de limpieza de storage</p>
            <p className="text-xs text-muted-foreground">
              Últimas {storageCleanupHistory.length || 50} corridas (cron + manual). Mostrá hasta 200.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="gap-2"
            onClick={() => void loadStorageCleanupHistory()}
            disabled={storageCleanupHistoryLoading}
          >
            <RefreshCcw className={`h-3.5 w-3.5 ${storageCleanupHistoryLoading ? "animate-spin" : ""}`} />
            {storageCleanupHistoryLoading ? "Cargando..." : "Refrescar"}
          </Button>
        </div>

        {storageCleanupHistoryLoading ? (
          <div className="mt-4 space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-8 rounded-xl bg-muted/30 animate-pulse" />
            ))}
          </div>
        ) : storageCleanupHistory.length === 0 ? (
          <div className="mt-4 flex flex-col items-center gap-3 py-10 text-center">
            <HardDrive className="h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-foreground/70 font-medium">No hay corridas registradas</p>
            <p className="text-xs text-muted-foreground">La proxima corrida — manual o cron — va a aparecer aca.</p>
          </div>
        ) : (
          <div data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope mt-4 overflow-x-auto rounded-2xl border border-border/50">
            <table className="min-w-full divide-y divide-border/40 text-xs">
              <thead className="bg-muted/40">
                <tr className="text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-3 py-2 font-medium">Fecha</th>
                  <th className="px-3 py-2 font-medium">Origen</th>
                  <th className="px-3 py-2 font-medium">Modo</th>
                  <th className="px-3 py-2 font-medium text-right">Escaneados</th>
                  <th className="px-3 py-2 font-medium text-right">Huérf.</th>
                  <th className="px-3 py-2 font-medium text-right">Borr.</th>
                  <th className="px-3 py-2 font-medium text-right">Fail</th>
                  <th className="px-3 py-2 font-medium">Duración</th>
                  <th className="px-3 py-2 font-medium">Estado</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {storageCleanupHistory.map((run) => (
                  <tr key={run.id} className="hover:bg-accent/10">
                    <td className="px-3 py-1.5 whitespace-nowrap text-foreground/90">
                      {formatPlatformTimestamp(run.started_at, "—")}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Badge variant={run.triggered_by === "cron" ? "secondary" : "outline"} className="text-[10px] font-normal">
                        {run.triggered_by === "cron"
                          ? "cron"
                          : run.triggered_by_user_name ?? "manual"}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      <Badge variant={run.dry_run ? "outline" : "default"} className="text-[10px] font-normal">
                        {run.dry_run ? "dry-run" : "real"}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-right text-muted-foreground">{number(run.scanned)}</td>
                    <td className="px-3 py-1.5 text-right text-warning font-medium">{number(run.orphans)}</td>
                    <td className="px-3 py-1.5 text-right text-foreground/90">{number(run.deleted)}</td>
                    <td className={`px-3 py-1.5 text-right ${run.failed > 0 ? "text-destructive font-semibold" : "text-muted-foreground"}`}>
                      {number(run.failed)}
                    </td>
                    <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">{formatDurationShort(run.duration_ms)}</td>
                    <td className="px-3 py-1.5 whitespace-nowrap">
                      {run.status === "ok" ? (
                        <span className="text-success">OK</span>
                      ) : run.status === "skipped" ? (
                        <span className="text-warning" title={run.reason ?? ""}>
                          skipped
                        </span>
                      ) : (
                        <span className="text-destructive">{run.status}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SuperAdminPanel>

      {/* 9. pendingAction Dialog */}
      <Dialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <DialogContent
          className={cn("super-admin-theme-scope max-w-md", dialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>{pendingAction?.label}</DialogTitle>
            <DialogDescription>{pendingAction?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setPendingAction(null)}>Cancelar</Button>
            <Button
              variant="destructive"
              onClick={async () => { await pendingAction?.onConfirm(); setPendingAction(null) }}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
