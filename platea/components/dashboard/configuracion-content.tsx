"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Check, CreditCard, Globe, Link2, Loader2, Power, Save, ShieldCheck, Undo2, User } from "lucide-react"
import {
  EMPRESA_FLOWS,
  formatEmpresaFeeFlowLabel,
  normalizeEmpresaMarketplaceFeeByFlow,
  type EmpresaMarketplaceFeeContract,
} from "@/lib/empresa-fees"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import {
  formatMarketplaceFeeSummary,
  getSalesReadinessMessage,
  getSalesReadinessStatusLabel,
  type SalesReadinessReason,
  type SalesReadinessStatus,
} from "@/lib/tenant"
import { toast } from "sonner"
import { PASSWORD_POLICY_HELPER_TEXT, validatePasswordPolicy } from "@/lib/password-policy"
import { formatMoney } from "@/lib/format"

// Oculto a pedido, de momento -- ver comentario junto al render de "Pagos en cuotas".
const SHOW_CUOTAS_CONFIG = false

type SaveState = "idle" | "saving" | "saved"

function useSaveStatus(): [SaveState, (next: SaveState) => void] {
  const [state, setState] = useState<SaveState>("idle")
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current)
    }
  }, [])

  const set = (next: SaveState) => {
    if (timer.current) clearTimeout(timer.current)
    setState(next)
    if (next === "saved") {
      timer.current = setTimeout(() => setState("idle"), 2500)
    }
  }

  return [state, set]
}

function SaveStatus({ state }: { state: SaveState }) {
  return (
    <div aria-live="polite" className="flex h-5 items-center text-xs font-medium">
      {state === "saving" ? (
        <span className="inline-flex items-center gap-1.5 text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" aria-hidden />
          Guardando…
        </span>
      ) : state === "saved" ? (
        <span className="inline-flex items-center gap-1.5 text-success">
          <Check className="h-3 w-3" aria-hidden />
          Guardado
        </span>
      ) : null}
    </div>
  )
}

function SectionCard({
  id,
  icon: Icon,
  title,
  subtitle,
  status,
  children,
}: {
  id: string
  icon: React.ElementType
  title: string
  subtitle: string
  status?: SaveState
  children: React.ReactNode
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 bg-card rounded-2xl border border-border/60 p-5">
      <div className="flex items-start justify-between gap-3 mb-5">
        <div className="flex items-start gap-2.5">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" aria-hidden />
          <div>
            <h2 id={`${id}-title`} className="text-[15px] font-semibold tracking-tight text-foreground">{title}</h2>
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          </div>
        </div>
        {status !== undefined ? <SaveStatus state={status} /> : null}
      </div>
      {children}
    </section>
  )
}

function OptionPills<T extends number>({
  options,
  value,
  onSelect,
  disabled,
  pending,
  format,
  label,
}: {
  options: readonly T[]
  value: T
  onSelect: (v: T) => void
  disabled?: boolean
  pending: T | null
  format: (v: T) => string
  label: string
}) {
  return (
    <div className="flex flex-wrap gap-2" role="group" aria-label={label}>
      {options.map((opt) => {
        const selected = value === opt
        const isPending = pending === opt
        return (
          <button
            key={opt}
            type="button"
            aria-pressed={selected}
            onClick={() => onSelect(opt)}
            disabled={disabled}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-background text-foreground hover:bg-muted"
            }`}
          >
            {isPending ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
            {format(opt)}
          </button>
        )
      })}
    </div>
  )
}

export default function ConfiguracionContent({
  empresa,
  permisos,
  esEmpleado,
  loadError,
}: {
  empresa: {
    id: string
    nombre: string
    slug: string
    email?: string | null
    admin_nombre?: string | null
    admin_apellido?: string | null
    sales_readiness?: {
      status: SalesReadinessStatus
      reason: SalesReadinessReason | null
      canSell: boolean
    }
    tenant_public_disabled?: number | boolean
    mp_max_installments?: number
    fee_billing_mode?: string
    fee_split_buyer_pct?: number | null
    buyer_event_refunds_enabled?: number | boolean
    buyer_auto_refunds_enabled?: number | boolean
    buyer_auto_refunds_scope?: string | null
    buyer_cool_off_window_hours?: number
    buyer_request_window_days?: number
    manual_review_sla_days?: number
  } & EmpresaMarketplaceFeeContract
  permisos?: Permisos
  esEmpleado?: boolean
  loadError?: string
}) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const canEdit = puede("editar_configuracion") && !loadError
  const router = useRouter()

  // ── Cuenta y empresa (guardado manual con barra de cambios pendientes) ──
  const initialCuenta = {
    nombre: empresa.nombre ?? "",
    email: empresa.email ?? "",
    admin_nombre: empresa.admin_nombre ?? "",
    admin_apellido: empresa.admin_apellido ?? "",
  }
  const [baseline, setBaseline] = useState(initialCuenta)
  const [form, setForm] = useState(initialCuenta)
  const [savingCuenta, setSavingCuenta] = useState(false)
  const cuentaDirty =
    form.nombre !== baseline.nombre ||
    form.email !== baseline.email ||
    form.admin_nombre !== baseline.admin_nombre ||
    form.admin_apellido !== baseline.admin_apellido

  // ── Estado comercial ──
  const salesReadiness = empresa.sales_readiness
  const [tenantPublicDisabled, setTenantPublicDisabled] = useState(Boolean(empresa.tenant_public_disabled))
  const [tenantDialogOpen, setTenantDialogOpen] = useState(false)
  const [savingTenant, setSavingTenant] = useState(false)
  const marketplaceFeeByFlow = normalizeEmpresaMarketplaceFeeByFlow(empresa)
  const readinessVariant = salesReadiness?.status === "ready_to_sell"
    ? "default"
    : salesReadiness?.status === "blocked"
      ? "destructive"
      : "secondary"
  const checkoutHabilitado = !tenantPublicDisabled && Boolean(salesReadiness?.canSell)

  // ── Reembolsos (autosave con estado inline) ──
  const [buyerRefundsEnabled, setBuyerRefundsEnabled] = useState<boolean>(Boolean(empresa.buyer_event_refunds_enabled))
  const [buyerAutoEnabled, setBuyerAutoEnabled] = useState<boolean>(Boolean(empresa.buyer_auto_refunds_enabled))
  const [coolOffHours, setCoolOffHours] = useState<number>(empresa.buyer_cool_off_window_hours ?? 0)
  const [requestWindowDays, setRequestWindowDays] = useState<number>(empresa.buyer_request_window_days ?? 30)
  const [manualReviewSlaDays, setManualReviewSlaDays] = useState<number>(empresa.manual_review_sla_days ?? 7)
  const [refundsStatus, setRefundsStatus] = useSaveStatus()
  const [pendingRequestWindow, setPendingRequestWindow] = useState<number | null>(null)
  const [pendingCoolOff, setPendingCoolOff] = useState<number | null>(null)
  const [pendingSla, setPendingSla] = useState<number | null>(null)

  // ── Pagos (autosave con estado inline) ──
  const [mpMaxInstallments, setMpMaxInstallments] = useState<number>(empresa.mp_max_installments ?? 1)
  const [pendingInstallments, setPendingInstallments] = useState<number | null>(null)
  const [feeBillingMode, setFeeBillingMode] = useState<"absorbed" | "passed_to_buyer" | "split">(
    empresa.fee_billing_mode === "passed_to_buyer"
      ? "passed_to_buyer"
      : empresa.fee_billing_mode === "split"
        ? "split"
        : "absorbed"
  )
  const [pendingFeeMode, setPendingFeeMode] = useState<"absorbed" | "passed_to_buyer" | "split" | null>(null)
  const [feeSplitBuyerPct, setFeeSplitBuyerPct] = useState<number>(
    empresa.fee_split_buyer_pct !== undefined && empresa.fee_split_buyer_pct !== null
      ? Math.min(100, Math.max(0, Number(empresa.fee_split_buyer_pct)))
      : 50
  )
  const [pagosStatus, setPagosStatus] = useSaveStatus()
  const feePctEntradas = (() => {
    const cfg = empresa.marketplace_fee_by_flow?.entradas ?? empresa.marketplaceFeeByFlow?.entradas
    return Number(cfg?.percentage ?? 0)
  })()

  // ── Seguridad ──
  const [passwordForm, setPasswordForm] = useState({
    passwordActual: "",
    nuevaPassword: "",
    confirmarPassword: "",
  })
  const [savingPassword, setSavingPassword] = useState(false)

  // ── Navegación de secciones (scrollspy) ──
  const navItems = [
    { id: "cuenta", label: "Cuenta" },
    { id: "estado", label: "Estado comercial" },
    { id: "reembolsos", label: "Reembolsos" },
    { id: "pagos", label: "Pagos y comisión" },
    ...(!esEmpleado ? [{ id: "seguridad", label: "Seguridad" }] : []),
  ]
  const [activeSection, setActiveSection] = useState("cuenta")

  useEffect(() => {
    const sections = navItems
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null)
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActiveSection(entry.target.id)
        }
      },
      { rootMargin: "-15% 0px -70% 0px" }
    )
    sections.forEach((el) => observer.observe(el))
    return () => observer.disconnect()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [esEmpleado])

  function scrollToSection(id: string) {
    setActiveSection(id)
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches
    document.getElementById(id)?.scrollIntoView({ behavior: prefersReduced ? "auto" : "smooth", block: "start" })
  }

  async function handleGuardarCuenta(e: React.FormEvent) {
    e.preventDefault()
    setSavingCuenta(true)
    try {
      const res = await fetch("/api/configuracion", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          email: form.email,
          admin_nombre: form.admin_nombre,
          admin_apellido: form.admin_apellido,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar la configuración")
        return
      }
      setBaseline(form)
      toast.success("Datos de la cuenta actualizados")
      router.refresh()
    } finally {
      setSavingCuenta(false)
    }
  }

  async function handleGuardarRefunds(patch: {
    buyer_event_refunds_enabled?: boolean
    buyer_auto_refunds_enabled?: boolean
    buyer_cool_off_window_hours?: number
    buyer_request_window_days?: number
    manual_review_sla_days?: number
  }) {
    setRefundsStatus("saving")
    try {
      const res = await fetch("/api/configuracion/refunds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo guardar la política de reembolsos")
        setRefundsStatus("idle")
        return
      }
      if (patch.buyer_event_refunds_enabled !== undefined) setBuyerRefundsEnabled(patch.buyer_event_refunds_enabled)
      if (patch.buyer_auto_refunds_enabled !== undefined) setBuyerAutoEnabled(patch.buyer_auto_refunds_enabled)
      if (patch.buyer_cool_off_window_hours !== undefined) setCoolOffHours(patch.buyer_cool_off_window_hours)
      if (patch.buyer_request_window_days !== undefined) setRequestWindowDays(patch.buyer_request_window_days)
      if (patch.manual_review_sla_days !== undefined) setManualReviewSlaDays(patch.manual_review_sla_days)
      setRefundsStatus("saved")
    } catch {
      toast.error("No se pudo guardar la política de reembolsos")
      setRefundsStatus("idle")
    } finally {
      setPendingRequestWindow(null)
      setPendingCoolOff(null)
      setPendingSla(null)
    }
  }

  async function handleGuardarFeeMode(
    nuevo: "absorbed" | "passed_to_buyer" | "split",
    pct?: number
  ) {
    // En split, permitimos re-guardar aunque el modo no cambie (cambió el %).
    const splitPct = nuevo === "split"
      ? Math.min(100, Math.max(0, Math.round(pct ?? feeSplitBuyerPct)))
      : undefined
    if (nuevo === feeBillingMode && nuevo !== "split") return
    setPendingFeeMode(nuevo)
    setPagosStatus("saving")
    try {
      const res = await fetch("/api/configuracion/pagos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          nuevo === "split"
            ? { fee_billing_mode: nuevo, fee_split_buyer_pct: splitPct }
            : { fee_billing_mode: nuevo }
        ),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo guardar quién paga la comisión")
        setPagosStatus("idle")
        return
      }
      setFeeBillingMode(nuevo)
      if (splitPct !== undefined) setFeeSplitBuyerPct(splitPct)
      setPagosStatus("saved")
    } catch {
      toast.error("No se pudo guardar quién paga la comisión")
      setPagosStatus("idle")
    } finally {
      setPendingFeeMode(null)
    }
  }

  async function handleGuardarInstallments(nuevo: number) {
    if (nuevo === mpMaxInstallments) return
    setPendingInstallments(nuevo)
    setPagosStatus("saving")
    try {
      const res = await fetch("/api/configuracion/pagos", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mp_max_installments: nuevo }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo guardar el máximo de cuotas")
        setPagosStatus("idle")
        return
      }
      setMpMaxInstallments(nuevo)
      setPagosStatus("saved")
    } catch {
      toast.error("No se pudo guardar el máximo de cuotas")
      setPagosStatus("idle")
    } finally {
      setPendingInstallments(null)
    }
  }

  async function handleCambiarPassword(e: React.FormEvent) {
    e.preventDefault()
    if (!passwordForm.passwordActual || !passwordForm.nuevaPassword || !passwordForm.confirmarPassword) {
      toast.error("Completá todos los campos de contraseña")
      return
    }

    const validationError = validatePasswordPolicy(passwordForm.nuevaPassword)
    if (validationError) {
      toast.error(validationError)
      return
    }

    if (passwordForm.nuevaPassword !== passwordForm.confirmarPassword) {
      toast.error("Las contraseñas nuevas no coinciden")
      return
    }

    setSavingPassword(true)
    try {
      const res = await fetch("/api/configuracion/password", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(passwordForm),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo cambiar la contraseña")
        return
      }
      toast.success("Contraseña actualizada correctamente")
      setPasswordForm({ passwordActual: "", nuevaPassword: "", confirmarPassword: "" })
    } finally {
      setSavingPassword(false)
    }
  }

  type FeeModeRow = { label: string; value: string; tone?: string; divider?: boolean }
  type FeeModeOption = {
    mode: "absorbed" | "passed_to_buyer" | "split"
    title: string
    description: string
    rows: FeeModeRow[]
  }
  // Ejemplo trabajado: venta de $10.000, comisión de plataforma de feePctEntradas%.
  const ejemploPrecio = 10000
  const ejemploComision = ejemploPrecio * feePctEntradas / 100
  // En split, el comprador paga splitPct% de la comisión, la empresa absorbe el resto.
  const ejemploCompradorPaga = ejemploComision * feeSplitBuyerPct / 100
  const ejemploEmpresaAbsorbe = ejemploComision - ejemploCompradorPaga
  const feeModeOptions: FeeModeOption[] = [
    {
      mode: "absorbed",
      title: "La absorbo yo",
      description: `El comprador ve un precio limpio. Vos recibís el precio menos la comisión (${feePctEntradas}%).`,
      rows: [
        { label: "Vendés a:", value: formatMoney(ejemploPrecio) },
        { label: "Comprador paga:", value: formatMoney(ejemploPrecio) },
        { label: `Comisión (${feePctEntradas}%):`, value: `−${formatMoney(ejemploComision)}`, tone: "text-rose-600 dark:text-rose-400" },
        { label: "Recibís:", value: formatMoney(ejemploPrecio - ejemploComision), divider: true },
      ],
    },
    {
      mode: "split",
      title: "La repartimos",
      description: `Elegís qué % de la comisión paga el comprador como cargo por servicio. El resto lo absorbés vos.`,
      rows: [
        { label: "Vendés a:", value: formatMoney(ejemploPrecio) },
        { label: `+ Comprador paga (${feeSplitBuyerPct}%):`, value: `+${formatMoney(ejemploCompradorPaga)}`, tone: "text-muted-foreground" },
        { label: `Vos absorbés (${100 - feeSplitBuyerPct}%):`, value: `−${formatMoney(ejemploEmpresaAbsorbe)}`, tone: "text-rose-600 dark:text-rose-400" },
        { label: "Recibís:", value: formatMoney(ejemploPrecio - ejemploEmpresaAbsorbe), divider: true },
      ],
    },
    {
      mode: "passed_to_buyer",
      title: "La paga el comprador",
      description: "El comprador ve precio + cargo por servicio discriminado. Vos recibís el precio completo.",
      rows: [
        { label: "Vendés a:", value: formatMoney(ejemploPrecio) },
        { label: `+ Comisión (${feePctEntradas}%):`, value: `+${formatMoney(ejemploComision)}`, tone: "text-muted-foreground" },
        { label: "Comprador paga:", value: formatMoney(ejemploPrecio + ejemploComision), divider: true },
        { label: "Recibís:", value: formatMoney(ejemploPrecio), tone: "text-success" },
      ],
    },
  ]

  async function handleConfirmarTenantPublicStatus() {
    const nextValue = !tenantPublicDisabled
    setSavingTenant(true)
    try {
      const res = await fetch("/api/configuracion/public-status", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ publicDisabled: nextValue }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo actualizar la disponibilidad pública")
        return
      }
      setTenantPublicDisabled(nextValue)
      setTenantDialogOpen(false)
      toast.success(nextValue ? "Tu sitio público quedó dado de baja" : "Tu sitio público volvió a estar activo")
      router.refresh()
    } finally {
      setSavingTenant(false)
    }
  }

  return (
    <div className="space-y-5 pb-8">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Configuración</h1>
        <p className="text-muted-foreground text-sm mt-1">
          Cuenta, estado comercial, reembolsos, pagos y seguridad de tu empresa
        </p>
      </div>

      {loadError ? (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          No se pudo cargar toda la configuración: {loadError}. Dejé la pantalla accesible, pero bloqueé la edición hasta que el backend responda bien.
        </div>
      ) : null}

      <nav
        aria-label="Secciones de configuración"
        className="sticky top-0 z-20 -mx-1 flex gap-1.5 overflow-x-auto bg-card/95 px-1 py-2 backdrop-blur-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => scrollToSection(item.id)}
            aria-current={activeSection === item.id ? "location" : undefined}
            className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              activeSection === item.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* ───────────────────────── Cuenta y empresa ───────────────────────── */}
      <SectionCard id="cuenta" icon={User} title="Cuenta y empresa" subtitle="Datos internos de administración de la cuenta">
        <form id="form-cuenta" onSubmit={handleGuardarCuenta} className="max-w-2xl space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-nombre" className="text-[13px] font-medium text-foreground/70">Nombre de la empresa</Label>
              <Input id="cfg-nombre" className="h-10" maxLength={200} value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} disabled={!canEdit} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-email" className="text-[13px] font-medium text-foreground/70">Email de la cuenta</Label>
              <Input id="cfg-email" className="h-10" type="email" maxLength={254} value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!canEdit} required />
            </div>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-admin-nombre" className="text-[13px] font-medium text-foreground/70">Nombre administrador</Label>
              <Input id="cfg-admin-nombre" className="h-10" maxLength={100} value={form.admin_nombre} onChange={(e) => setForm({ ...form, admin_nombre: e.target.value })} disabled={!canEdit} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-admin-apellido" className="text-[13px] font-medium text-foreground/70">Apellido administrador</Label>
              <Input id="cfg-admin-apellido" className="h-10" maxLength={100} value={form.admin_apellido} onChange={(e) => setForm({ ...form, admin_apellido: e.target.value })} disabled={!canEdit} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cfg-subdominio" className="text-[13px] font-medium text-foreground/70">Subdominio del sitio público</Label>
            <Input id="cfg-subdominio" className="h-10 font-mono" value={`${empresa.slug}.ticketera.com`} readOnly />
            <p className="text-xs text-muted-foreground">
              Solo lectura acá: el sitio público se administra desde el módulo <strong>Sitio de venta</strong>.
            </p>
          </div>
        </form>
      </SectionCard>

      {/* ───────────────────────── Estado comercial ───────────────────────── */}
      <SectionCard id="estado" icon={Globe} title="Estado comercial" subtitle="Visibilidad del sitio público, estado de cobros y comisión activa">
        <div className="space-y-4">
          {!esEmpleado ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-foreground">Sitio público</p>
                  <Badge variant={tenantPublicDisabled ? "destructive" : "default"} className="rounded-md">
                    {tenantPublicDisabled ? "Dado de baja" : "Activo"}
                  </Badge>
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {tenantPublicDisabled
                    ? "El sitio público, checkout y accesos de comprador están bloqueados. Tu dashboard sigue operativo."
                    : "El sitio público está visible y los compradores pueden comprar según el estado de cobros."}
                </p>
              </div>
              <Button
                type="button"
                variant={tenantPublicDisabled ? "default" : "destructive"}
                className="h-10"
                disabled={!canEdit}
                onClick={() => setTenantDialogOpen(true)}
              >
                <Power className="mr-2 h-4 w-4" aria-hidden />
                {tenantPublicDisabled ? "Dar de alta" : "Dar de baja"}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/30 px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-sm font-semibold text-foreground">Estado de cobros</p>
                {salesReadiness ? (
                  <Badge variant={readinessVariant} className="rounded-md">{getSalesReadinessStatusLabel(salesReadiness.status)}</Badge>
                ) : null}
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                {getSalesReadinessMessage(salesReadiness, "dashboard")}
              </p>
            </div>
            <Button asChild variant="outline" className="h-10">
              <Link href="/dashboard/cobros">
                <Link2 className="h-4 w-4 mr-2" aria-hidden />
                Ver módulo de Cobros
              </Link>
            </Button>
          </div>

          <div>
            <div className="rounded-xl border border-border/60 divide-y divide-border/60">
              {EMPRESA_FLOWS.map((flow) => (
                <div key={flow} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                  <span className="text-sm text-muted-foreground">Comisión · {formatEmpresaFeeFlowLabel(flow)}</span>
                  <span className="text-sm font-semibold text-foreground font-mono tabular-nums">
                    {formatMarketplaceFeeSummary(marketplaceFeeByFlow[flow])}
                  </span>
                </div>
              ))}
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
                <span className="text-sm text-muted-foreground">Impacto en checkout</span>
                <span className="inline-flex items-center gap-2 text-sm font-medium text-foreground">
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${checkoutHabilitado ? "bg-success" : "bg-muted-foreground/50"}`}
                    aria-hidden
                  />
                  {tenantPublicDisabled
                    ? "Checkout dado de baja por decisión de la empresa"
                    : salesReadiness?.canSell
                      ? "Checkout habilitado para vender"
                      : "Checkout bloqueado hasta resolver cobros"}
                </span>
              </div>
            </div>
            <p className="mt-2 text-xs text-muted-foreground">
              Las comisiones las define Ticketera y son de solo lectura para la empresa.
            </p>
          </div>
        </div>
      </SectionCard>

      {/* ───────────────────────── Reembolsos ───────────────────────── */}
      <SectionCard
        id="reembolsos"
        icon={Undo2}
        title="Reembolsos del comprador"
        subtitle="Si el comprador puede cancelar desde su panel y cuándo se aprueba automático"
        status={refundsStatus}
      >
        <div className="max-w-xl space-y-3">
          <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
            <div>
              <p className="text-sm font-medium text-foreground">Permitir reembolso pedido por el comprador</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                El comprador ve el botón &quot;Cancelar y reembolsar&quot; en su panel de tickets.
              </p>
            </div>
            <Switch
              checked={buyerRefundsEnabled}
              disabled={!canEdit || refundsStatus === "saving"}
              onCheckedChange={(checked) => void handleGuardarRefunds({ buyer_event_refunds_enabled: checked })}
              aria-label="Permitir reembolso pedido por el comprador"
            />
          </div>

          {buyerRefundsEnabled ? (
            <>
              <div className="rounded-xl border border-border/60 bg-muted/20 divide-y divide-border/60">
                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">Tiempo límite para pedir reembolso</p>
                  <OptionPills
                    options={[7, 15, 30, 60, 90] as const}
                    value={requestWindowDays}
                    pending={pendingRequestWindow}
                    disabled={!canEdit || refundsStatus === "saving"}
                    format={(d) => `${d} días`}
                    label="Tiempo límite del comprador para pedir reembolso"
                    onSelect={(d) => {
                      setPendingRequestWindow(d)
                      void handleGuardarRefunds({ buyer_request_window_days: d })
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Pasado este plazo desde la compra, el comprador ya no puede pedir reembolso de esa entrada.
                  </p>
                </div>

                <div className="p-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-foreground">Auto-aprobar reembolsos</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Sin revisión manual: el sistema procesa el reembolso al toque cuando el comprador lo pide.
                      </p>
                    </div>
                    <Switch
                      checked={buyerAutoEnabled}
                      disabled={!canEdit || refundsStatus === "saving"}
                      onCheckedChange={(checked) => void handleGuardarRefunds({ buyer_auto_refunds_enabled: checked })}
                      aria-label="Auto-aprobar reembolsos"
                    />
                  </div>
                </div>

                {buyerAutoEnabled ? (
                  <div className="p-4 space-y-2">
                    <p className="text-sm font-medium text-foreground">Ventana de auto-aprobación (cool-off)</p>
                    <OptionPills
                      options={[0, 6, 12, 24, 48, 72, 168] as const}
                      value={coolOffHours}
                      pending={pendingCoolOff}
                      disabled={!canEdit || refundsStatus === "saving"}
                      format={(h) => (h === 0 ? "Sin límite" : h === 168 ? "7 días" : `${h} hs`)}
                      label="Ventana de auto-aprobación"
                      onSelect={(h) => {
                        setPendingCoolOff(h)
                        void handleGuardarRefunds({ buyer_cool_off_window_hours: h })
                      }}
                    />
                    <p className="text-xs text-muted-foreground">
                      {coolOffHours === 0
                        ? "Sin límite de tiempo: cualquier pedido se auto-aprueba, sin importar cuántos días pasaron desde la compra."
                        : `Solo se auto-aprueban pedidos hechos dentro de las ${coolOffHours} horas siguientes a la compra. Fuera de ventana pasan a revisión manual.`}
                    </p>
                  </div>
                ) : null}

                <div className="p-4 space-y-2">
                  <p className="text-sm font-medium text-foreground">SLA de revisión manual</p>
                  <OptionPills
                    options={[3, 5, 7, 14, 30] as const}
                    value={manualReviewSlaDays}
                    pending={pendingSla}
                    disabled={!canEdit || refundsStatus === "saving"}
                    format={(d) => `${d} días`}
                    label="SLA de revisión manual"
                    onSelect={(d) => {
                      setPendingSla(d)
                      void handleGuardarRefunds({ manual_review_sla_days: d })
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Si no aprobás ni rechazás un pedido en este tiempo, se aprueba automáticamente para no dejar al comprador en limbo.
                  </p>
                </div>
              </div>

              <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
                <strong className="text-foreground font-medium">Recomendación:</strong> activá <em>auto-aprobar</em> con cool-off de <em>24 a 48 horas</em>. Reducís contracargos
                (el comprador ve que puede cancelar sin pelear apenas compra) sin perder control: los pedidos hechos después de esa ventana pasan a revisión manual en vez de aprobarse solos.
              </div>
            </>
          ) : (
            <p className="text-xs text-muted-foreground px-1">
              Activá los reembolsos para configurar plazos, auto-aprobación y SLA de respuesta.
            </p>
          )}
        </div>
      </SectionCard>

      {/* ───────────────────────── Pagos y comisión ───────────────────────── */}
      <SectionCard
        id="pagos"
        icon={CreditCard}
        title="Pagos y comisión"
        subtitle="Quién paga el % de plataforma y cuántas cuotas ofrecés en el checkout"
        status={pagosStatus}
      >
        <div className="max-w-2xl space-y-6">
          <div className="space-y-3">
            <p className="text-sm font-medium text-foreground">¿Quién paga la comisión de plataforma?</p>
            <div role="radiogroup" aria-label="Quién paga la comisión de plataforma" className="grid gap-3 md:grid-cols-3">
              {feeModeOptions.map((option) => {
                const selected = feeBillingMode === option.mode
                const isPending = pendingFeeMode === option.mode
                return (
                  <button
                    key={option.mode}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => void handleGuardarFeeMode(option.mode)}
                    disabled={!canEdit || pagosStatus === "saving"}
                    className={`text-left rounded-xl border p-4 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-60 ${
                      selected ? "border-primary bg-primary/5" : "border-border bg-background hover:bg-muted/50"
                    }`}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground">{option.title}</span>
                      <span
                        aria-hidden
                        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition-colors duration-150 ${
                          selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background"
                        }`}
                      >
                        {isPending ? (
                          <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                        ) : selected ? (
                          <Check className="h-3 w-3" />
                        ) : null}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mb-3">{option.description}</p>
                    <div className="rounded-md bg-muted/40 p-2 text-xs space-y-1">
                      {option.rows.map((row) => (
                        <div
                          key={row.label}
                          className={`flex justify-between ${row.tone ?? ""} ${row.divider ? "border-t border-border/40 pt-1" : ""}`}
                        >
                          <span>{row.label}</span>
                          <strong className="font-mono tabular-nums">{row.value}</strong>
                        </div>
                      ))}
                    </div>
                  </button>
                )
              })}
            </div>

            {feeBillingMode === "split" ? (
              <div className="rounded-xl border border-border bg-muted/30 p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="fee-split-pct" className="text-sm font-medium text-foreground">
                    ¿Qué % de la comisión paga el comprador?
                  </Label>
                  <div className="flex items-center gap-1.5">
                    <Input
                      id="fee-split-pct"
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      step={5}
                      value={feeSplitBuyerPct}
                      disabled={!canEdit || pagosStatus === "saving"}
                      onChange={(e) => {
                        const raw = Number(e.target.value)
                        if (!Number.isFinite(raw)) return
                        setFeeSplitBuyerPct(Math.min(100, Math.max(0, Math.round(raw))))
                      }}
                      onBlur={() => void handleGuardarFeeMode("split", feeSplitBuyerPct)}
                      className="h-10 w-20 text-right font-mono tabular-nums"
                    />
                    <span className="text-sm font-medium text-muted-foreground">%</span>
                  </div>
                </div>
                <input
                  type="range"
                  aria-label="Porcentaje de la comisión que paga el comprador"
                  min={0}
                  max={100}
                  step={5}
                  value={feeSplitBuyerPct}
                  disabled={!canEdit || pagosStatus === "saving"}
                  onChange={(e) => setFeeSplitBuyerPct(Math.min(100, Math.max(0, Number(e.target.value))))}
                  onPointerUp={() => void handleGuardarFeeMode("split", feeSplitBuyerPct)}
                  onKeyUp={() => void handleGuardarFeeMode("split", feeSplitBuyerPct)}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-muted accent-primary disabled:cursor-not-allowed disabled:opacity-60"
                />
                <div className="flex justify-between text-[11px] text-muted-foreground">
                  <span>0% · la absorbés toda</span>
                  <span>100% · la paga toda el comprador</span>
                </div>
                <p className="text-xs text-muted-foreground">
                  Con una comisión de {formatMoney(ejemploComision)} sobre una venta de {formatMoney(ejemploPrecio)}, el comprador paga{" "}
                  <strong className="text-primary">+{formatMoney(ejemploCompradorPaga)}</strong> y vos absorbés{" "}
                  <strong className="text-rose-600 dark:text-rose-400">{formatMoney(ejemploEmpresaAbsorbe)}</strong>.
                </p>
              </div>
            ) : null}

            <div className="rounded-lg border border-border/60 bg-muted/40 p-3 text-xs text-muted-foreground">
              <strong className="text-foreground font-medium">Tip:</strong> la comisión es siempre la misma ({feePctEntradas}% para entradas), solo cambiás quién la paga. Podés
              repartirla entre vos y el comprador. La parte que paga el comprador se ve en el checkout discriminada como &quot;cargo por
              servicio&quot; — entiende qué paga y por qué.
            </div>
          </div>

          {/* Pagos en cuotas: oculto a pedido, de momento -- el estado, el handler y el
              endpoint PATCH /configuracion/pagos siguen intactos para reactivarlo. */}
          {SHOW_CUOTAS_CONFIG && (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-foreground">Pagos en cuotas</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Cuántas cuotas máximas ofrecés en Mercado Pago al momento del checkout.
                </p>
              </div>
              <OptionPills
                options={[1, 3, 6, 9, 12, 18, 24] as const}
                value={mpMaxInstallments}
                pending={pendingInstallments}
                disabled={!canEdit || pagosStatus === "saving"}
                format={(n) => (n === 1 ? "Solo contado" : `Hasta ${n}`)}
                label="Cuotas máximas"
                onSelect={(n) => void handleGuardarInstallments(n)}
              />
              <div className="rounded-lg border border-border/50 bg-muted/50 p-3 text-xs text-muted-foreground">
                <strong>Cuotas sin interés:</strong> se configuran en tu panel de Mercado Pago → &quot;Promociones bancarias&quot;. Si ahí
                activás cuotas sin interés con tu costo financiero, el comprador las ve automáticamente al pagar. Acá solo controlás
                el máximo de cuotas permitidas.
              </div>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ───────────────────────── Seguridad ───────────────────────── */}
      {!esEmpleado && (
        <SectionCard id="seguridad" icon={ShieldCheck} title="Seguridad de la cuenta" subtitle="Cambio de contraseña de la cuenta maestra de la empresa">
          <form onSubmit={(e) => void handleCambiarPassword(e)} className="max-w-md space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="cfg-pass-actual" className="text-[13px] font-medium text-foreground/70">Contraseña actual</Label>
              <Input
                id="cfg-pass-actual"
                type="password"
                autoComplete="current-password"
                className="h-10"
                value={passwordForm.passwordActual}
                disabled={!canEdit}
                onChange={(e) => setPasswordForm({ ...passwordForm, passwordActual: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-pass-nueva" className="text-[13px] font-medium text-foreground/70">Nueva contraseña</Label>
              <Input
                id="cfg-pass-nueva"
                type="password"
                autoComplete="new-password"
                className="h-10"
                value={passwordForm.nuevaPassword}
                disabled={!canEdit}
                onChange={(e) => setPasswordForm({ ...passwordForm, nuevaPassword: e.target.value })}
              />
              <p className="text-xs text-muted-foreground">{PASSWORD_POLICY_HELPER_TEXT}</p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="cfg-pass-confirmar" className="text-[13px] font-medium text-foreground/70">Confirmar nueva contraseña</Label>
              <Input
                id="cfg-pass-confirmar"
                type="password"
                autoComplete="new-password"
                className="h-10"
                value={passwordForm.confirmarPassword}
                disabled={!canEdit}
                onChange={(e) => setPasswordForm({ ...passwordForm, confirmarPassword: e.target.value })}
              />
            </div>
            <Button type="submit" variant="outline" className="h-10" disabled={!canEdit || savingPassword}>
              {savingPassword ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : null}
              Cambiar contraseña
            </Button>
          </form>
        </SectionCard>
      )}

      {/* Barra flotante de cambios sin guardar (sección Cuenta) */}
      {cuentaDirty ? (
        <div className="pointer-events-none sticky bottom-4 z-30 flex justify-center">
          <div className="pointer-events-auto flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border/60 bg-card/95 px-3 py-2.5 backdrop-blur sm:px-4 shadow-lg">
            <p className="text-sm text-foreground" aria-live="polite">Tenés cambios sin guardar en <strong>Cuenta y empresa</strong></p>
            <div className="flex items-center gap-2">
              <Button type="button" variant="ghost" className="h-10" disabled={savingCuenta} onClick={() => setForm(baseline)}>
                Descartar
              </Button>
              <Button type="submit" form="form-cuenta" className="gap-2 h-10 flex-1 sm:flex-none" disabled={!canEdit || savingCuenta}>
                {savingCuenta ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Save className="h-4 w-4" aria-hidden />}
                Guardar cambios
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Confirmación de alta/baja del sitio público */}
      <Dialog open={tenantDialogOpen} onOpenChange={(open) => { if (!savingTenant) setTenantDialogOpen(open) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {tenantPublicDisabled ? "Dar de alta el sitio público" : "Dar de baja el sitio público"}
            </DialogTitle>
            <DialogDescription>
              {tenantPublicDisabled
                ? "Tu sitio público vuelve a estar visible y los compradores van a poder comprar según el estado de cobros."
                : "Se bloquean el sitio público, el checkout y los accesos de comprador. Tu dashboard sigue operativo y podés revertirlo cuando quieras."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={savingTenant} onClick={() => setTenantDialogOpen(false)}>
              Cancelar
            </Button>
            <Button
              type="button"
              variant={tenantPublicDisabled ? "default" : "destructive"}
              disabled={savingTenant}
              onClick={() => void handleConfirmarTenantPublicStatus()}
            >
              {savingTenant ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden /> : <Power className="mr-2 h-4 w-4" aria-hidden />}
              {tenantPublicDisabled ? "Dar de alta" : "Dar de baja"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
