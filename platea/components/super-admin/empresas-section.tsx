"use client"

import { useEffect, useState } from "react"
import dynamic from "next/dynamic"
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Building2,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Download,
  Filter,
  Info,
  LoaderCircle,
  MoreHorizontal,
  RotateCcw,
  Search,
  SearchX,
  TrendingUp,
  X,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Checkbox } from "@/components/ui/checkbox"
import { Tooltip as HintTooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useLoading } from "@/components/loading-provider"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import type { PlatformCompanyDetail, PlatformCompanyFeesData, PlatformCompanySummary, PlatformFlow, PlatformFeeMode } from "@/components/super-admin/types"
import { formatFeeSummary, formatFlowLabel, getFeeSourceLabel, getReadinessLabel, money, number } from "@/components/super-admin/utils"
import { formatDate } from "@/lib/format"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const EmpresaDetailChart = dynamic(
  () => import("@/components/super-admin/empresa-detail-chart"),
  { ssr: false, loading: () => <div className="h-full w-full animate-pulse rounded-2xl bg-muted/30" /> },
)

type PlatformCompaniesResponse = { data: { empresas: PlatformCompanySummary[] } }
type PlatformCompanyDetailResponse = { data: PlatformCompanyDetail }
type PlatformCompanyFeesResponse = { data: PlatformCompanyFeesData }
type PlatformCompanyFeeUpdateResponse = {
  data: {
    flow: PlatformFlow
    marketplaceFeeByFlow: Record<PlatformFlow, PlatformCompanySummary["marketplaceFeeByFlow"][PlatformFlow]>
    overridesByFlow: Record<PlatformFlow, PlatformCompanySummary["marketplaceFeeByFlow"][PlatformFlow]>
  }
}

type PlatformCompanyPublicStatusResponse = {
  data: {
    tenantPublicDisabled: boolean
  }
}

type PlatformCompanySuspensionResponse = {
  data: {
    suspendido: boolean
    motivo: string | null
  }
}

type PlatformCompanyAprobacionResponse = {
  data: {
    empresaId: string
    aprobada: boolean
  }
}

type PlatformCompanyEsPruebaResponse = {
  data: {
    empresaId: string
    esPrueba: boolean
    es_prueba: boolean
  }
}

type FeeFormState = {
  mode: PlatformFeeMode
  percentage: string
  fixedAmount: string
}

function OverrideHint({ tooltipClassName }: { tooltipClassName: string }) {
  return (
    <TooltipProvider>
      <HintTooltip>
        <TooltipTrigger asChild>
          <span className="inline-flex cursor-help items-center gap-1 rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
            Override
            <Info className="h-3 w-3" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className={cn("max-w-72 px-3 py-2.5 text-xs leading-relaxed", tooltipClassName)}>
          Esta empresa no usa el fee global para este flow. Tiene una configuración propia definida desde superadmin.
        </TooltipContent>
      </HintTooltip>
    </TooltipProvider>
  )
}

function buildFeeForm(flow: PlatformFlow, fees: PlatformCompanyFeesData | null): FeeFormState {
  const summary = fees?.overridesByFlow[flow]?.configured ? fees.overridesByFlow[flow] : fees?.resolvedByFlow[flow]
  return {
    mode: summary?.mode ?? "percentage",
    percentage: summary?.percentage?.toString() ?? "",
    fixedAmount: summary?.fixedAmount?.toString() ?? "",
  }
}

function getReadinessBadgeClass(readiness: PlatformCompanySummary["salesReadiness"], tenantPublicDisabled = false) {
  if (tenantPublicDisabled) {
    return "!border-destructive/30 !bg-destructive/15 !text-destructive"
  }
  if (readiness.canSell) {
    return "!border-success/30 !bg-success/15 !text-success"
  }
  return "!border-border !bg-secondary !text-foreground"
}

export default function EmpresasSection({
  initialCompanies,
  canManageSingletonOnly,
}: {
  initialCompanies: PlatformCompanySummary[]
  canManageSingletonOnly: boolean
}) {
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const [companies, setCompanies] = useState(initialCompanies)
  const [selectedCompany, setSelectedCompany] = useState<PlatformCompanySummary | null>(null)
  const [companyDetail, setCompanyDetail] = useState<PlatformCompanyDetail | null>(null)
  const [companyFees, setCompanyFees] = useState<PlatformCompanyFeesData | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [selectedFlow, setSelectedFlow] = useState<PlatformFlow>("entradas")
  const [feeForm, setFeeForm] = useState<FeeFormState>({ mode: "percentage", percentage: "", fixedAmount: "" })
  const [isExportingOwner, setIsExportingOwner] = useState(false)
  const [pendingAction, setPendingAction] = useState<{ label: string; description: string; onConfirm: () => Promise<void>; variant?: "default" | "destructive" } | null>(null)
  const [tempPasswordResult, setTempPasswordResult] = useState<{ password: string; copied: boolean } | null>(null)
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createForm, setCreateForm] = useState({ nombre: '', slug: '', email: '', admin_nombre: '', admin_apellido: '' })
  const [createResult, setCreateResult] = useState<{ temporaryPassword: string; email: string; slug: string; copied: boolean } | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [statusFilter, setStatusFilter] = useState<"all" | "ready" | "issues" | "suspended" | "pending">("all")
  const [autoAprobar, setAutoAprobar] = useState(false)
  const [autoAprobarLoaded, setAutoAprobarLoaded] = useState(false)
  const [autoAprobarSaving, setAutoAprobarSaving] = useState(false)
  const [autoAprobarDialogOpen, setAutoAprobarDialogOpen] = useState(false)
  const [aprobarPendientesTambien, setAprobarPendientesTambien] = useState(false)
  const [currentPage, setCurrentPage] = useState(0)
  const [pageSize, setPageSize] = useState<25 | 50 | 100>(25)
  const [sortKey, setSortKey] = useState<"nombre" | "ventas" | "volumen" | "ganancia" | "registro">("ganancia")
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc")
  const [detailTab, setDetailTab] = useState<"overview" | "config" | "acciones">("overview")

  const pendingCount = companies.filter((c) => c.aprobada === false).length

  useEffect(() => {
    setFeeForm(buildFeeForm(selectedFlow, companyFees))
  }, [companyFees, selectedFlow])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const res = await fetch("/api/platform/configuracion/auto-aprobacion")
        const json = (await res.json()) as { data?: { auto_aprobar_empresas?: boolean }; error?: string }
        if (cancelled) return
        if (res.ok && json.data) {
          setAutoAprobar(Boolean(json.data.auto_aprobar_empresas))
        }
      } catch {
        // silencioso: el switch queda en OFF por defecto
      } finally {
        if (!cancelled) setAutoAprobarLoaded(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredCompanies = companies.filter((c) => {
    const q = searchQuery.trim().toLowerCase()
    if (q && !c.nombre.toLowerCase().includes(q) && !c.slug.toLowerCase().includes(q)) return false
    if (statusFilter === "ready") return c.salesReadiness.status === "ready_to_sell" && !c.suspendido
    if (statusFilter === "issues") return c.salesReadiness.status !== "ready_to_sell"
    if (statusFilter === "suspended") return c.suspendido
    if (statusFilter === "pending") return c.aprobada === false
    return true
  })

  const sortedCompanies = [...filteredCompanies].sort((a, b) => {
    let aVal: string | number
    let bVal: string | number
    if (sortKey === "nombre") { aVal = a.nombre.toLowerCase(); bVal = b.nombre.toLowerCase() }
    else if (sortKey === "ventas") { aVal = a.ventas; bVal = b.ventas }
    else if (sortKey === "volumen") { aVal = a.volumenBruto; bVal = b.volumenBruto }
    else if (sortKey === "registro") { aVal = a.created_at ?? ""; bVal = b.created_at ?? "" }
    else { aVal = a.gananciasOwner; bVal = b.gananciasOwner }
    if (aVal < bVal) return sortDir === "asc" ? -1 : 1
    if (aVal > bVal) return sortDir === "asc" ? 1 : -1
    return 0
  })
  const pagedCompanies = sortedCompanies.slice(currentPage * pageSize, (currentPage + 1) * pageSize)
  const pageStart = filteredCompanies.length === 0 ? 0 : currentPage * pageSize + 1
  const pageEnd = Math.min((currentPage + 1) * pageSize, filteredCompanies.length)

  // Single reference for effectiveTheme — only needed for data-superadmin-theme attribute on DialogContent
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme

  // Stable class constants using CSS vars (no effectiveTheme branching)
  const tooltipClassName = "border-border bg-popover text-popover-foreground shadow-xl ring-1 ring-border/50"
  const detailDialogClassName = "border-border bg-popover shadow-[var(--superadmin-panel-shadow)] ring-1 ring-border/10"
  const modalSurfaceClassName = "border-border bg-secondary/40"
  const modalInnerCardClassName = "border-border bg-card"
  const modalControlClassName = "border-input bg-background text-foreground"

  // KPI derived values
  const totalOwnerEarnings = companies.reduce((s, c) => s + c.gananciasOwner, 0)
  const readyCount = companies.filter((c) => c.salesReadiness.canSell && !c.suspendido).length

  async function handleExportOwnerEarnings() {
    if (isExportingOwner) return
    setIsExportingOwner(true)
    try {
      const res = await fetch("/api/platform/empresas/owner-earnings/export")
      if (!res.ok) {
        toast.error("No se pudo exportar las ganancias por empresa")
        return
      }
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `owner-earnings-${new Date().toLocaleDateString('sv', { timeZone: 'America/Argentina/Buenos_Aires' })}.csv`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {
      toast.error("No se pudo descargar el CSV")
    } finally {
      setIsExportingOwner(false)
    }
  }

  async function refreshCompanies() {
    const res = await fetch("/api/platform/empresas")
    const data = (await res.json()) as PlatformCompaniesResponse | { error?: string }
    if (!res.ok || !("data" in data)) {
      throw new Error((data as { error?: string }).error ?? "No se pudo actualizar el directorio de empresas")
    }
    setCompanies(data.data.empresas)
  }

  async function handleRefreshCompanies() {
    setIsRefreshing(true)
    try {
      await refreshCompanies()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "No se pudo actualizar el directorio de empresas")
    } finally {
      setIsRefreshing(false)
    }
  }

  async function openCompanyDetail(company: PlatformCompanySummary) {
    setSelectedCompany(company)
    setCompanyDetail(null)
    setCompanyFees(null)
    setSelectedFlow("entradas")
    setDetailTab("overview")
    setDetailOpen(true)
    setDetailLoading(true)

    const [detailRes, feesRes] = await Promise.all([
      fetch(`/api/platform/empresas/${company.id}/ganancias`),
      fetch(`/api/platform/empresas/${company.id}/fees`),
    ])

    const detailData = (await detailRes.json()) as PlatformCompanyDetailResponse | { error?: string }
    const feesData = (await feesRes.json()) as PlatformCompanyFeesResponse | { error?: string }
    setDetailLoading(false)

    if (!detailRes.ok || !("data" in detailData)) {
      toast.error((detailData as { error?: string }).error ?? "No se pudo cargar el detalle comercial")
      setDetailOpen(false)
      return
    }

    if (!feesRes.ok || !("data" in feesData)) {
      toast.error((feesData as { error?: string }).error ?? "No se pudo cargar la política de fees")
      setDetailOpen(false)
      return
    }

    setCompanyDetail(detailData.data)
    setCompanyFees(feesData.data)
  }

  async function updateCompanyFee() {
    if (!selectedCompany) return
    setPendingAction({
      label: "Cambiar override de fee",
      description: `Vas a modificar el override de fee "${formatFlowLabel(selectedFlow)}" para "${selectedCompany.nombre}". Este cambio afecta la liquidación de pagos.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/fees`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              flow: selectedFlow,
              mode: feeForm.mode,
              percentage: feeForm.percentage ? Number(feeForm.percentage) : null,
              fixedAmount: feeForm.fixedAmount ? Number(feeForm.fixedAmount) : null,
            }),
          })
          const data = (await res.json()) as PlatformCompanyFeeUpdateResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar el override de empresa")
            return
          }
          setCompanies((prev) => prev.map((company) => company.id === selectedCompany.id ? { ...company, marketplaceFeeByFlow: data.data.marketplaceFeeByFlow } : company))
          setSelectedCompany((prev) => prev ? { ...prev, marketplaceFeeByFlow: data.data.marketplaceFeeByFlow } : prev)
          setCompanyFees((prev) => prev ? { ...prev, overridesByFlow: data.data.overridesByFlow, resolvedByFlow: data.data.marketplaceFeeByFlow } : prev)
          toast.success(`Override ${formatFlowLabel(selectedFlow).toLowerCase()} actualizado`)
        })
      },
    })
  }

  async function updateCompanyPublicStatus(publicDisabled: boolean) {
    if (!selectedCompany) return
    setPendingAction({
      label: publicDisabled ? "Dar de baja la empresa" : "Reactivar empresa públicamente",
      description: publicDisabled
        ? `Vas a dar de baja "${selectedCompany.nombre}". El sitio de venta dejará de ser accesible públicamente.`
        : `Vas a reactivar el sitio público de "${selectedCompany.nombre}".`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/public-status`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ publicDisabled }),
          })
          const data = (await res.json()) as PlatformCompanyPublicStatusResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar el estado público")
            return
          }
          setCompanies((prev) => prev.map((company) => company.id === selectedCompany.id
            ? { ...company, tenantPublicDisabled: data.data.tenantPublicDisabled }
            : company))
          setSelectedCompany((prev) => prev ? { ...prev, tenantPublicDisabled: data.data.tenantPublicDisabled } : prev)
          toast.success(data.data.tenantPublicDisabled ? "Empresa dada de baja" : "Empresa dada de alta")
        })
      },
    })
  }

  async function updateCompanyEsPrueba(esPrueba: boolean) {
    if (!selectedCompany) return
    setPendingAction({
      label: esPrueba ? "Marcar como cuenta de prueba" : "Marcar como cuenta real",
      description: esPrueba
        ? `Vas a marcar "${selectedCompany.nombre}" como cuenta de PRUEBA. Sus datos dejarán de impactar en métricas globales, MRR, rankings y revenue del superadmin. La empresa sigue funcionando normalmente para sus usuarios.`
        : `Vas a marcar "${selectedCompany.nombre}" como cuenta REAL. Sus datos volverán a contar en las métricas globales del superadmin.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/es-prueba`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ esPrueba }),
          })
          const data = (await res.json()) as PlatformCompanyEsPruebaResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar la cuenta")
            return
          }
          setCompanies((prev) => prev.map((company) => company.id === selectedCompany.id
            ? { ...company, esPrueba: data.data.esPrueba }
            : company))
          setSelectedCompany((prev) => prev ? { ...prev, esPrueba: data.data.esPrueba } : prev)
          toast.success(data.data.esPrueba ? "Cuenta marcada como prueba" : "Cuenta marcada como real")
        })
      },
    })
  }

  async function createEmpresa() {
    const { nombre, slug, email, admin_nombre, admin_apellido } = createForm
    if (!nombre.trim() || !slug.trim() || !email.trim() || !admin_nombre.trim()) {
      toast.error('Completá nombre, slug, email y nombre de admin')
      return
    }
    await withLoading(async () => {
      const res = await fetch('/api/platform/empresas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nombre: nombre.trim(), slug: slug.trim(), email: email.trim(), admin_nombre: admin_nombre.trim(), admin_apellido: admin_apellido.trim() || undefined }),
      })
      const json = await res.json() as { data?: { temporaryPassword?: string; email?: string; slug?: string }; error?: string }
      if (!res.ok) { toast.error(json?.error ?? 'Error al crear empresa'); return }
      setCreateDialogOpen(false)
      setCreateForm({ nombre: '', slug: '', email: '', admin_nombre: '', admin_apellido: '' })
      setCreateResult({ temporaryPassword: json.data?.temporaryPassword ?? '', email: json.data?.email ?? '', slug: json.data?.slug ?? '', copied: false })
      await refreshCompanies()
    })
  }

  function triggerImpersonate(company: PlatformCompanySummary) {
    setSelectedCompany(company)
    setPendingAction({
      label: "Impersonar empresa",
      description: `Vas a iniciar sesión como "${company.nombre}". Todas las acciones que hagas afectarán su cuenta real.`,
      variant: "destructive",
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${company.id}/impersonate`, { method: 'POST' })
          const json = await res.json() as { data?: { token?: string }; error?: string }
          if (!res.ok) { toast.error(json?.error ?? 'Error al iniciar impersonation'); return }
          const token = json.data?.token
          if (!token) { toast.error('No se recibió token'); return }
          const relayRes = await fetch('/api/auth/impersonate-relay', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ token }),
          })
          if (!relayRes.ok) { toast.error('Error al preparar la sesión de impersonation'); return }
          window.open('/auth/impersonate', '_blank', 'noopener')
        })
      },
    })
  }

  async function resetEmpresaPassword() {
    if (!selectedCompany) return
    setPendingAction({
      label: "Resetear contraseña",
      description: `Vas a generar una contraseña temporal para "${selectedCompany.nombre}". La contraseña actual quedará inválida de inmediato. Vas a ver la nueva contraseña UNA SOLA VEZ — copiala antes de cerrar.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/reset-password`, {
            method: "POST",
          })
          const json = await res.json() as { data?: { temporaryPassword?: string }; error?: string }
          if (!res.ok) throw new Error(json?.error ?? "Error al resetear contraseña")
          setTempPasswordResult({ password: json.data?.temporaryPassword ?? "", copied: false })
        })
      },
    })
  }

  function triggerApproveFromRow(company: PlatformCompanySummary) {
    setSelectedCompany(company)
    setPendingAction({
      label: "Aprobar empresa",
      description: `Vas a aprobar "${company.nombre}". Va a poder entrar al dashboard y operar normalmente.`,
      variant: "default",
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${company.id}/aprobacion`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aprobada: true }),
          })
          const data = (await res.json()) as PlatformCompanyAprobacionResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar la aprobación")
            return
          }
          setCompanies((prev) => prev.map((c) => c.id === company.id ? { ...c, aprobada: data.data.aprobada } : c))
          setSelectedCompany((prev) => prev?.id === company.id ? { ...prev, aprobada: data.data.aprobada } : prev)
          toast.success("Empresa aprobada")
        })
      },
    })
  }

  function triggerSuspendFromRow(company: PlatformCompanySummary) {
    const willSuspend = !company.suspendido
    setSelectedCompany(company)
    setPendingAction({
      label: willSuspend ? "Suspender empresa" : "Reactivar empresa",
      description: willSuspend
        ? `Vas a suspender "${company.nombre}". Se bloqueará el acceso al dashboard y al sitio de venta.`
        : `Vas a reactivar "${company.nombre}". Recuperará acceso completo.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${company.id}/suspension`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suspendido: willSuspend }),
          })
          const data = (await res.json()) as PlatformCompanySuspensionResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar la suspensión")
            return
          }
          setCompanies((prev) => prev.map((c) => c.id === company.id ? { ...c, suspendido: data.data.suspendido } : c))
          setSelectedCompany((prev) => prev?.id === company.id ? { ...prev, suspendido: data.data.suspendido } : prev)
          toast.success(data.data.suspendido ? "Empresa suspendida" : "Empresa reactivada")
        })
      },
    })
  }

  function triggerResetPasswordFromRow(company: PlatformCompanySummary) {
    setSelectedCompany(company)
    setPendingAction({
      label: "Resetear contraseña",
      description: `Vas a generar una contraseña temporal para "${company.nombre}". La contraseña actual quedará inválida de inmediato. Vas a ver la nueva contraseña UNA SOLA VEZ — copiala antes de cerrar.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${company.id}/reset-password`, {
            method: "POST",
          })
          const json = await res.json() as { data?: { temporaryPassword?: string }; error?: string }
          if (!res.ok) throw new Error(json?.error ?? "Error al resetear contraseña")
          setTempPasswordResult({ password: json.data?.temporaryPassword ?? "", copied: false })
        })
      },
    })
  }

  async function patchAutoAprobar(value: boolean): Promise<boolean> {
    const res = await fetch("/api/platform/configuracion/auto-aprobacion", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ auto_aprobar_empresas: value }),
    })
    const json = (await res.json()) as { data?: { auto_aprobar_empresas?: boolean }; error?: string }
    if (!res.ok || !json.data) {
      toast.error(json.error ?? "No se pudo actualizar la auto-aprobación")
      return false
    }
    setAutoAprobar(Boolean(json.data.auto_aprobar_empresas))
    return true
  }

  function handleAutoAprobarToggle(next: boolean) {
    if (autoAprobarSaving) return
    if (next) {
      setAprobarPendientesTambien(false)
      setAutoAprobarDialogOpen(true)
      return
    }
    void withLoading(async () => {
      setAutoAprobarSaving(true)
      try {
        const ok = await patchAutoAprobar(false)
        if (ok) toast.success("Auto-aprobación desactivada")
      } finally {
        setAutoAprobarSaving(false)
      }
    })
  }

  async function confirmActivarAutoAprobar() {
    await withLoading(async () => {
      setAutoAprobarSaving(true)
      try {
        const ok = await patchAutoAprobar(true)
        if (!ok) return
        setAutoAprobarDialogOpen(false)
        toast.success("Auto-aprobación activada")

        if (aprobarPendientesTambien) {
          const res = await fetch("/api/platform/configuracion/aprobar-pendientes", { method: "POST" })
          const json = (await res.json()) as { data?: { aprobadas?: number }; error?: string }
          if (!res.ok || !json.data) {
            toast.error(json.error ?? "Se activó la auto-aprobación pero no se pudieron aprobar las pendientes")
            return
          }
          const aprobadas = json.data.aprobadas ?? 0
          toast.success(aprobadas === 1 ? "1 empresa pendiente aprobada" : `${aprobadas} empresas pendientes aprobadas`)
          try {
            await refreshCompanies()
          } catch {
            // refresco best-effort
          }
        }
      } finally {
        setAutoAprobarSaving(false)
      }
    })
  }

  async function updateCompanyAprobacion(aprobada: boolean) {
    if (!selectedCompany) return
    setPendingAction({
      label: aprobada ? "Aprobar empresa" : "Marcar como pendiente",
      description: aprobada
        ? `Vas a aprobar "${selectedCompany.nombre}". Va a poder entrar al dashboard y operar normalmente.`
        : `Vas a marcar "${selectedCompany.nombre}" como pendiente. Pierde el acceso al dashboard hasta que la vuelvas a aprobar.`,
      variant: aprobada ? "default" : "destructive",
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/aprobacion`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ aprobada }),
          })
          const data = (await res.json()) as PlatformCompanyAprobacionResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar la aprobación")
            return
          }
          setCompanies((prev) => prev.map((company) => company.id === selectedCompany.id
            ? { ...company, aprobada: data.data.aprobada }
            : company))
          setSelectedCompany((prev) => prev ? { ...prev, aprobada: data.data.aprobada } : prev)
          toast.success(data.data.aprobada ? "Empresa aprobada" : "Empresa marcada como pendiente")
        })
      },
    })
  }

  async function updateCompanySuspension(suspendido: boolean) {
    if (!selectedCompany) return
    setPendingAction({
      label: suspendido ? "Suspender empresa" : "Reactivar empresa",
      description: suspendido
        ? `Vas a suspender "${selectedCompany.nombre}". Se bloqueará el acceso al dashboard y al sitio de venta.`
        : `Vas a reactivar "${selectedCompany.nombre}". Recuperará acceso completo.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/suspension`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ suspendido }),
          })
          const data = (await res.json()) as PlatformCompanySuspensionResponse | { error?: string }
          if (!res.ok || !("data" in data)) {
            toast.error((data as { error?: string }).error ?? "No se pudo actualizar la suspensión")
            return
          }
          setCompanies((prev) => prev.map((company) => company.id === selectedCompany.id
            ? { ...company, suspendido: data.data.suspendido }
            : company))
          setSelectedCompany((prev) => prev ? { ...prev, suspendido: data.data.suspendido } : prev)
          toast.success(data.data.suspendido ? "Empresa suspendida" : "Empresa reactivada")
        })
      },
    })
  }

  function handleSort(col: typeof sortKey) {
    if (sortKey === col) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"))
    } else {
      setSortKey(col)
      setSortDir("desc")
    }
    setCurrentPage(0)
  }

  function SortIcon({ col }: { col: typeof sortKey }) {
    if (sortKey !== col) return <ArrowUpDown className="ml-1 inline h-3 w-3 opacity-40" />
    return sortDir === "asc"
      ? <ArrowUp className="ml-1 inline h-3 w-3" />
      : <ArrowDown className="ml-1 inline h-3 w-3" />
  }

  return (
    <div className="space-y-6">
      {/* 1. Read-only banner */}
      {!canManageSingletonOnly ? (
        <div className="rounded-2xl border border-warning/30 bg-warning/8 px-4 py-3 text-sm text-warning">
          Estás en modo lectura: necesitás la capability de overrides para editar esta superficie.
        </div>
      ) : null}

      {/* 2. KPI strip */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {/* Total */}
        <SuperAdminPanel className="p-4 border-border bg-card">
          <div className="mb-2 flex items-center gap-2">
            <Building2 className="h-4 w-4 text-muted-foreground" />
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Total</p>
          </div>
          <p className="text-2xl font-semibold text-foreground">{companies.length}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">empresas registradas</p>
        </SuperAdminPanel>

        {/* Pendientes — clickable */}
        <div
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => { setStatusFilter("pending"); setCurrentPage(0) }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setStatusFilter("pending"); setCurrentPage(0) } }}
        >
          <SuperAdminPanel className="h-full p-4 border-warning/30 bg-warning/8 transition hover:brightness-95">
            <div className="mb-2 flex items-center gap-2">
              <Clock className="h-4 w-4 text-warning" />
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Pendientes</p>
            </div>
            <p className="text-2xl font-semibold text-warning">{pendingCount}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">de aprobación</p>
          </SuperAdminPanel>
        </div>

        {/* Listas — clickable */}
        <div
          className="cursor-pointer"
          role="button"
          tabIndex={0}
          onClick={() => { setStatusFilter("ready"); setCurrentPage(0) }}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setStatusFilter("ready"); setCurrentPage(0) } }}
        >
          <SuperAdminPanel className="h-full p-4 border-success/30 bg-success/8 transition hover:brightness-95">
            <div className="mb-2 flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Listas</p>
            </div>
            <p className="text-2xl font-semibold text-success">{readyCount}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">para vender</p>
          </SuperAdminPanel>
        </div>

        {/* Ganancia owner total */}
        <SuperAdminPanel className="p-4">
          <div className="mb-2 flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-primary" />
            <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">Ganancia owner</p>
          </div>
          <p className="text-2xl font-mono font-semibold tabular-nums text-primary">{money(totalOwnerEarnings)}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">total acumulado</p>
        </SuperAdminPanel>
      </div>

      {/* 3. Main panel */}
      <SuperAdminPanel className="border-border/30">
        {/* Panel header */}
        <div className="mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <p className="font-semibold text-foreground">Directorio comercial</p>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => void handleRefreshCompanies()}
              disabled={isRefreshing}
              title="Actualizar directorio"
              className="h-7 w-7"
            >
              <RotateCcw className={cn("h-4 w-4", isRefreshing && "animate-spin")} />
            </Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="default"
              onClick={() => setCreateDialogOpen(true)}
            >
              + Nueva empresa
            </Button>
            <Button
              variant="outline"
              className="gap-2"
              onClick={() => void handleExportOwnerEarnings()}
              disabled={isExportingOwner}
              title="Descarga CSV con ganancias owner por empresa (entradas + consumibles)"
            >
              <Download className="h-4 w-4" />
              {isExportingOwner ? "Exportando..." : "Exportar ganancias"}
            </Button>
          </div>
        </div>

        {/* 4. Auto-aprobacion banner */}
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-border/40 bg-muted/20 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <Switch
              id="auto-aprobar-empresas"
              checked={autoAprobar}
              disabled={!canManageSingletonOnly || !autoAprobarLoaded || autoAprobarSaving}
              onCheckedChange={handleAutoAprobarToggle}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="auto-aprobar-empresas" className="cursor-pointer text-sm font-semibold text-foreground">
                Auto-aprobar empresas nuevas
              </Label>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Cuando está activo, las empresas que se registran entran sin tu aprobación manual.
              </p>
            </div>
          </div>
          {autoAprobar ? (
            <Badge variant="outline" className="!border-primary/40 !bg-primary/10 shrink-0 px-2.5 py-0.5 font-semibold uppercase tracking-wide !text-primary">
              Activo
            </Badge>
          ) : null}
        </div>

        {/* 5. Search + filter tabs */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar por nombre o slug..."
              value={searchQuery}
              onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(0) }}
              className="h-9 pl-9 pr-9"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => { setSearchQuery(""); setCurrentPage(0) }}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-2 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            {(["all", "pending", "ready", "issues", "suspended"] as const).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => { setStatusFilter(f); setCurrentPage(0) }}
                className={cn(
                  "rounded-full px-3 py-2 text-xs font-medium transition-colors",
                  statusFilter === f
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:bg-muted/80"
                )}
              >
                {f === "all"
                  ? `Todas (${companies.length})`
                  : f === "pending"
                    ? `Pendientes (${pendingCount})`
                    : f === "ready"
                      ? "Listas"
                      : f === "issues"
                        ? "Con issues"
                        : "Suspendidas"}
              </button>
            ))}
          </div>
        </div>

        {/* 6. Company table */}
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <th className="px-3 py-3">
                  <button type="button" className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("nombre")}>
                    Empresa <SortIcon col="nombre" />
                  </button>
                </th>
                <th className="hidden px-3 py-3 lg:table-cell">
                  <button type="button" className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("registro")}>
                    Registro <SortIcon col="registro" />
                  </button>
                </th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Fee entradas</th>
                <th className="px-3 py-3">Fee consumibles</th>
                <th className="px-3 py-3 text-right">
                  <button type="button" className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("ventas")}>
                    Ventas <SortIcon col="ventas" />
                  </button>
                </th>
                <th className="px-3 py-3 text-right">
                  <button type="button" className="inline-flex items-center hover:text-foreground transition-colors" onClick={() => handleSort("ganancia")}>
                    Ganancia owner <SortIcon col="ganancia" />
                  </button>
                </th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody>
              {/* Empty state: no companies at all */}
              {companies.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-14">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <Building2 className="h-10 w-10 text-muted-foreground/40" />
                      <p className="font-semibold text-foreground">Todavía no hay empresas registradas</p>
                      <p className="text-sm text-muted-foreground">Las empresas que se registren o crees manualmente van a aparecer acá.</p>
                      <Button variant="default" onClick={() => setCreateDialogOpen(true)}>+ Nueva empresa</Button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Empty state: filter active, no search */}
              {companies.length > 0 && filteredCompanies.length === 0 && !searchQuery.trim() && (
                <tr>
                  <td colSpan={8} className="px-3 py-14">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <Filter className="h-10 w-10 text-muted-foreground/40" />
                      <p className="font-semibold text-foreground">No hay empresas en este estado</p>
                      <Button variant="outline" onClick={() => { setStatusFilter("all"); setCurrentPage(0) }}>Ver todas</Button>
                    </div>
                  </td>
                </tr>
              )}

              {/* Empty state: search with no results */}
              {companies.length > 0 && filteredCompanies.length === 0 && searchQuery.trim() && (
                <tr>
                  <td colSpan={8} className="px-3 py-14">
                    <div className="flex flex-col items-center gap-3 text-center">
                      <SearchX className="h-10 w-10 text-muted-foreground/40" />
                      <p className="font-semibold text-foreground">No hay empresas que coincidan con &ldquo;{searchQuery}&rdquo;</p>
                      <div className="flex gap-2">
                        <Button variant="outline" onClick={() => { setSearchQuery(""); setStatusFilter("all"); setCurrentPage(0) }}>Limpiar búsqueda</Button>
                        <Button variant="outline" onClick={() => { setStatusFilter("all"); setCurrentPage(0) }}>Ver todas</Button>
                      </div>
                    </div>
                  </td>
                </tr>
              )}

              {pagedCompanies.map((company) => (
                <tr key={company.id} className="superadmin-row-card align-top transition">
                  {/* Empresa */}
                  <td className="rounded-l-2xl border-l border-y border-transparent bg-transparent px-3 py-4">
                    <p className="font-semibold text-foreground">{company.nombre}</p>
                    <p className="text-xs text-muted-foreground">{company.slug}.ticketera.com</p>
                  </td>

                  {/* Registro */}
                  <td className="hidden border-y border-transparent bg-transparent px-3 py-4 font-mono text-sm tabular-nums text-muted-foreground lg:table-cell">
                    {formatDate(company.created_at)}
                  </td>

                  {/* Estado */}
                  <td className="border-y border-transparent bg-transparent px-3 py-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant="outline" className={cn("px-2.5 py-0.5 font-semibold", getReadinessBadgeClass(company.salesReadiness, company.tenantPublicDisabled))}>
                        {getReadinessLabel(company.salesReadiness, company.tenantPublicDisabled)}
                      </Badge>
                      <div className="flex items-center gap-1">
                        {company.aprobada === false && (
                          <TooltipProvider>
                            <HintTooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-block h-2 w-2 rounded-full bg-warning" />
                              </TooltipTrigger>
                              <TooltipContent className={tooltipClassName}>Pendiente de aprobación</TooltipContent>
                            </HintTooltip>
                          </TooltipProvider>
                        )}
                        {company.suspendido && (
                          <TooltipProvider>
                            <HintTooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-block h-2 w-2 rounded-full bg-destructive" />
                              </TooltipTrigger>
                              <TooltipContent className={tooltipClassName}>Suspendida</TooltipContent>
                            </HintTooltip>
                          </TooltipProvider>
                        )}
                        {company.esPrueba && (
                          <TooltipProvider>
                            <HintTooltip>
                              <TooltipTrigger asChild>
                                <span className="inline-block h-2 w-2 rounded-full bg-primary" />
                              </TooltipTrigger>
                              <TooltipContent className={tooltipClassName}>Cuenta de prueba</TooltipContent>
                            </HintTooltip>
                          </TooltipProvider>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Fee entradas + Fee consumibles */}
                  {(["entradas", "consumibles"] as const).map((flow) => (
                    <td key={flow} className="border-y border-transparent bg-transparent px-3 py-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="font-mono font-medium tabular-nums text-foreground">{formatFeeSummary(company.marketplaceFeeByFlow[flow])}</p>
                        {company.marketplaceFeeByFlow[flow].source === "empresa" ? <OverrideHint tooltipClassName={tooltipClassName} /> : null}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">{getFeeSourceLabel(company.marketplaceFeeByFlow[flow])}</p>
                    </td>
                  ))}

                  {/* Ventas */}
                  <td className="border-y border-transparent bg-transparent px-3 py-4 text-right font-mono tabular-nums text-foreground">
                    {number(company.ventas)}
                  </td>

                  {/* Ganancia owner */}
                  <td className="border-y border-transparent bg-transparent px-3 py-4 text-right font-mono font-semibold tabular-nums text-primary">
                    {money(company.gananciasOwner)}
                  </td>

                  {/* Acciones */}
                  <td className="rounded-r-2xl border-r border-y border-transparent bg-transparent px-3 py-4">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="h-8 w-8">
                          <MoreHorizontal className="h-4 w-4" />
                          <span className="sr-only">Acciones</span>
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope">
                        <DropdownMenuItem onClick={() => void openCompanyDetail(company)}>
                          Ver detalle
                        </DropdownMenuItem>
                        {company.aprobada === false && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              className="text-success focus:text-success"
                              onClick={() => triggerApproveFromRow(company)}
                            >
                              Aprobar empresa
                            </DropdownMenuItem>
                          </>
                        )}
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-warning focus:text-warning"
                          onClick={() => triggerImpersonate(company)}
                        >
                          Impersonar
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => triggerResetPasswordFromRow(company)}
                        >
                          Resetear contraseña
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => triggerSuspendFromRow(company)}
                        >
                          {company.suspendido ? "Reactivar empresa" : "Suspender empresa"}
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 7. Pagination bar */}
        {filteredCompanies.length > 0 && (
          <div className="mt-4 flex items-center justify-between border-t border-border/30 pt-4">
            <p className="text-sm text-muted-foreground">
              Mostrando {pageStart}–{pageEnd} de {filteredCompanies.length} empresa{filteredCompanies.length === 1 ? "" : "s"}
            </p>
            <div className="flex items-center gap-2">
              <Select
                value={String(pageSize)}
                onValueChange={(v) => { setPageSize(Number(v) as 25 | 50 | 100); setCurrentPage(0) }}
              >
                <SelectTrigger className="h-8 w-[95px] text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope">
                  <SelectItem value="25">25 / pág</SelectItem>
                  <SelectItem value="50">50 / pág</SelectItem>
                  <SelectItem value="100">100 / pág</SelectItem>
                </SelectContent>
              </Select>
              <Button
                variant="outline"
                size="sm"
                aria-label="Página anterior"
                onClick={() => setCurrentPage((p) => p - 1)}
                disabled={currentPage === 0}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="sm"
                aria-label="Página siguiente"
                onClick={() => setCurrentPage((p) => p + 1)}
                disabled={pageEnd >= filteredCompanies.length}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SuperAdminPanel>

      {/* 8. Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent
          className={cn("super-admin-theme-scope max-h-[88vh] overflow-hidden rounded-[28px] p-0 sm:max-w-5xl", detailDialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <div className="superadmin-modal-scroll max-h-[88vh] overflow-y-auto px-6 py-6 sm:px-7 sm:py-7">
            <DialogHeader>
              <DialogTitle className="font-(family-name:var(--font-display)) text-3xl text-foreground">{selectedCompany?.nombre ?? "Empresa"}</DialogTitle>
              <DialogDescription className="text-muted-foreground">Detalle owner por flow, defaults globales y overrides por empresa.</DialogDescription>
            </DialogHeader>

            {detailLoading ? (
              <div className="flex items-center justify-center py-16 text-muted-foreground">
                <LoaderCircle className="mr-3 h-5 w-5 animate-spin" /> Cargando detalle…
              </div>
            ) : companyDetail && companyFees ? (
              <>
                <div className="mt-5 flex gap-1 rounded-xl border border-border bg-secondary/40 p-1">
                  {(["overview", "config", "acciones"] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setDetailTab(t)}
                      className={cn(
                        "flex-1 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                        detailTab === t
                          ? "bg-popover text-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t === "overview" ? "Métricas" : t === "config" ? "Configuración" : "Acciones"}
                    </button>
                  ))}
                </div>
                <div className="mt-5 space-y-5">
                  <div hidden={detailTab !== "overview"} className="grid gap-4 sm:grid-cols-3">
                  <div className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Volumen bruto</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{money(companyDetail.volumenBruto)}</p>
                  </div>
                  <div className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Ganancia owner</p>
                    <p className="mt-2 text-xl font-semibold text-primary">{money(companyDetail.gananciasOwner)}</p>
                  </div>
                  <div className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                    <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">Ventas</p>
                    <p className="mt-2 text-xl font-semibold text-foreground">{number(companyDetail.ventas)}</p>
                  </div>
                </div>

                  <div hidden={detailTab !== "overview"} className="grid gap-5 xl:grid-cols-[1.15fr_0.85fr]">
                  <div className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                    <p className="font-semibold text-foreground">Serie temporal owner</p>
                    <div className="mt-5 h-72">
                      <EmpresaDetailChart data={companyDetail.serieTemporal} />
                    </div>

                    <div className="mt-5 grid gap-3 sm:grid-cols-2">
                      {(["entradas", "consumibles"] as const).map((flow) => (
                        <div key={flow} className={cn("rounded-2xl border p-4", modalInnerCardClassName)}>
                          <p className="font-medium text-foreground">{formatFlowLabel(flow)}</p>
                          <p className="mt-2 text-sm text-muted-foreground">Ventas: {number(companyDetail.metricasPorFlow[flow].ventasTotales)}</p>
                          <p className="mt-1 text-sm text-muted-foreground">Volumen: {money(companyDetail.metricasPorFlow[flow].volumenBruto)}</p>
                          <p className="mt-1 text-sm text-primary">Owner: {money(companyDetail.metricasPorFlow[flow].gananciasOwner)}</p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="font-semibold text-foreground">Fee marketplace por flow</p>
                        <p className="mt-1 text-sm text-muted-foreground">Default global, override empresa y fee resuelto.</p>
                      </div>
                      <select
                        aria-label="Seleccionar flow"
                        className={cn("h-10 rounded-xl border px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring", modalControlClassName)}
                        value={selectedFlow}
                        onChange={(e) => setSelectedFlow(e.target.value as PlatformFlow)}
                      >
                        <option value="entradas">Entradas</option>
                        <option value="consumibles">Consumibles</option>
                      </select>
                    </div>

                    <div className="mt-5 grid gap-3">
                      {[
                        { label: "Default global", value: companyFees.defaultsByFlow[selectedFlow] },
                        { label: "Override empresa", value: companyFees.overridesByFlow[selectedFlow] },
                        { label: "Fee resuelto", value: companyFees.resolvedByFlow[selectedFlow] },
                      ].map((item) => (
                        <div key={item.label} className={cn("rounded-2xl border px-4 py-3", modalInnerCardClassName)}>
                          <p className="text-xs uppercase tracking-[0.22em] text-muted-foreground">{item.label}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <p className="font-semibold text-foreground">{formatFeeSummary(item.value)}</p>
                            {item.label === "Override empresa" && item.value?.source === "empresa" ? <OverrideHint tooltipClassName={tooltipClassName} /> : null}
                          </div>
                          <p className="mt-1 text-xs text-muted-foreground">{getFeeSourceLabel(item.value)}</p>
                        </div>
                      ))}
                    </div>

                    <div className="mt-5 space-y-4">
                      <div>
                        <Label htmlFor="emp-fee-modo" className="text-xs text-muted-foreground">Modo</Label>
                        <select
                          id="emp-fee-modo"
                          disabled={!canManageSingletonOnly}
                          className={cn("mt-1 h-10 w-full rounded-xl border px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60", modalControlClassName)}
                          value={feeForm.mode}
                          onChange={(e) => setFeeForm((prev) => ({ ...prev, mode: e.target.value as PlatformFeeMode }))}
                        >
                          <option value="percentage">Porcentaje</option>
                          <option value="fixed">Monto fijo</option>
                          <option value="hybrid">Híbrida</option>
                        </select>
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Porcentaje</Label>
                        <Input disabled={!canManageSingletonOnly} className={cn("mt-1 h-10 disabled:opacity-60", modalControlClassName)} value={feeForm.percentage} onChange={(e) => setFeeForm((prev) => ({ ...prev, percentage: e.target.value }))} placeholder="4" />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Monto fijo</Label>
                        <Input disabled={!canManageSingletonOnly} className={cn("mt-1 h-10 disabled:opacity-60", modalControlClassName)} value={feeForm.fixedAmount} onChange={(e) => setFeeForm((prev) => ({ ...prev, fixedAmount: e.target.value }))} placeholder="0" />
                      </div>
                      <Button disabled={!canManageSingletonOnly} className="w-full bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground" onClick={updateCompanyFee}>
                        Guardar override de {formatFlowLabel(selectedFlow).toLowerCase()}
                      </Button>
                    </div>
                  </div>
                </div>

                <div hidden={detailTab !== "config"} className={cn(
                  "rounded-2xl border p-5",
                  selectedCompany?.aprobada === false
                    ? "border-warning/30 bg-warning/8"
                    : modalSurfaceClassName,
                )}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="font-semibold text-foreground">Aprobación de la cuenta</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedCompany?.aprobada === false
                          ? "Esta empresa se registró públicamente y está PENDIENTE DE APROBACIÓN. No puede entrar al dashboard hasta que la apruebes. Revisá que sea legítima antes de habilitarla."
                          : "Esta empresa está aprobada y puede operar normalmente. Si la marcás como pendiente, pierde el acceso al dashboard hasta que la vuelvas a aprobar."}
                      </p>
                    </div>
                    <Button
                      disabled={!canManageSingletonOnly}
                      variant={selectedCompany?.aprobada === false ? "default" : "outline"}
                      className="w-full lg:w-auto"
                      onClick={() => void updateCompanyAprobacion(selectedCompany?.aprobada === false)}
                    >
                      {selectedCompany?.aprobada === false ? "Aprobar empresa" : "Marcar como pendiente"}
                    </Button>
                  </div>
                </div>

                <div hidden={detailTab !== "config"} className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="font-semibold text-foreground">Estado público de la cuenta</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedCompany?.tenantPublicDisabled
                          ? "Esta empresa está dada de baja públicamente. Su tenant, checkout y accesos de comprador asociados dejan de estar disponibles, pero el dashboard interno sigue operativo para que pueda volver a activarse."
                          : "Esta empresa está publicada y operativa en su superficie pública. Si la das de baja, el tenant desaparece para compradores y se bloquea todo acceso público asociado sin afectar el dashboard interno."}
                      </p>
                    </div>
                    <Button
                      disabled={!canManageSingletonOnly}
                      variant={selectedCompany?.tenantPublicDisabled ? "default" : "destructive"}
                      className="w-full lg:w-auto"
                      onClick={() => void updateCompanyPublicStatus(!selectedCompany?.tenantPublicDisabled)}
                    >
                      {selectedCompany?.tenantPublicDisabled ? "Volver a dar de alta" : "Dar de baja cuenta"}
                    </Button>
                  </div>
                </div>

                <div hidden={detailTab !== "config"} className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="font-semibold text-foreground">Cuenta de prueba</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedCompany?.esPrueba
                          ? `Esta empresa está marcada como PRUEBA. Sus métricas (ventas, ingresos, comisiones) no impactan en el dashboard ni en los rankings del superadmin. Para sus usuarios la cuenta funciona normalmente.`
                          : `Marcala como cuenta de prueba si es un demo o entorno de testing. Sus datos dejan de contar en las métricas globales del superadmin pero la empresa sigue funcionando idéntico para sus usuarios.`}
                      </p>
                    </div>
                    <Button
                      disabled={!canManageSingletonOnly}
                      variant={selectedCompany?.esPrueba ? "default" : "outline"}
                      className="w-full lg:w-auto"
                      onClick={() => void updateCompanyEsPrueba(!selectedCompany?.esPrueba)}
                    >
                      {selectedCompany?.esPrueba ? "Marcar como cuenta real" : "Marcar como prueba"}
                    </Button>
                  </div>
                </div>

                <div hidden={detailTab !== "acciones"} className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="font-semibold text-foreground">Impersonar empresa</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Abre una nueva pestaña con la sesión de esta empresa. El token dura 2 minutos y es de un solo uso. Al terminar vas a tener que volver a iniciar sesión como superadmin.
                      </p>
                    </div>
                    <Button
                      disabled={!canManageSingletonOnly}
                      variant="outline"
                      className="w-full lg:w-auto"
                      onClick={() => selectedCompany && triggerImpersonate(selectedCompany)}
                    >
                      Impersonar
                    </Button>
                  </div>
                </div>

                <div hidden={detailTab !== "config"} className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                  <p className="font-semibold text-foreground">Feature flags</p>
                  <p className="mt-1 mb-4 text-sm text-muted-foreground">Módulos habilitados para esta empresa. Los cambios son inmediatos — el sidebar del dashboard se actualiza en el próximo login.</p>
                  <div className="flex flex-wrap gap-3">
                    {(
                      [
                        { key: "revendedor_habilitado" as const, label: "Revendedores", enabled: selectedCompany?.revendedorHabilitado !== false },
                        { key: "consumibles_habilitado" as const, label: "Consumibles", enabled: selectedCompany?.consumiblesHabilitado !== false },
                      ] as const
                    ).map(({ key, label, enabled }) => (
                      <button
                        key={key}
                        type="button"
                        disabled={!canManageSingletonOnly}
                        onClick={() => {
                          if (!selectedCompany) return
                          const nextEnabled = !enabled
                          const applyFeatureChange = async () => {
                            const res = await fetch(`/api/platform/empresas/${selectedCompany.id}/features`, {
                              method: "PATCH",
                              headers: { "Content-Type": "application/json" },
                              body: JSON.stringify({ [key]: nextEnabled }),
                            })
                            const json = await res.json() as { data?: { revendedorHabilitado: boolean; consumiblesHabilitado: boolean }; error?: string }
                            if (!res.ok) { toast.error(json.error ?? "Error al actualizar feature flag"); return }
                            if (json.data) {
                              setCompanies((prev) => prev.map((c) => c.id === selectedCompany.id
                                ? { ...c, revendedorHabilitado: json.data!.revendedorHabilitado, consumiblesHabilitado: json.data!.consumiblesHabilitado }
                                : c))
                              setSelectedCompany((prev) => prev ? { ...prev, revendedorHabilitado: json.data!.revendedorHabilitado, consumiblesHabilitado: json.data!.consumiblesHabilitado } : prev)
                            }
                            toast.success(nextEnabled ? `${label} habilitados` : `${label} deshabilitados`)
                          }
                          if (enabled) {
                            // deshabilitar → requiere confirmación
                            setPendingAction({
                              label: `Deshabilitar ${label}`,
                              description: `Vas a deshabilitar ${label} para "${selectedCompany.nombre}". Los empleados perderán acceso inmediatamente.`,
                              variant: "destructive",
                              onConfirm: () => withLoading(applyFeatureChange),
                            })
                          } else {
                            // habilitar → directo
                            void withLoading(applyFeatureChange)
                          }
                        }}
                        className={cn(
                          "rounded-xl border px-4 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60",
                          enabled
                            ? "border-success/30 bg-success/8 text-success hover:bg-success/15"
                            : "border-border bg-secondary text-foreground hover:bg-card"
                        )}
                      >
                        {label}: {enabled ? "Habilitado" : "Deshabilitado"}
                      </button>
                    ))}
                  </div>
                </div>

                <div hidden={detailTab !== "acciones"} className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="font-semibold text-foreground">Resetear contraseña</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        Genera una contraseña temporal para la empresa. La contraseña actual queda inválida al instante. Usá esto cuando la empresa perdió el acceso y no puede recuperar la contraseña por email. La nueva contraseña se muestra una sola vez.
                      </p>
                    </div>
                    <Button
                      disabled={!canManageSingletonOnly}
                      variant="destructive"
                      className="w-full lg:w-auto"
                      onClick={() => void resetEmpresaPassword()}
                    >
                      Resetear contraseña
                    </Button>
                  </div>
                </div>

                <div hidden={detailTab !== "acciones"} className={cn("rounded-2xl border p-5", modalSurfaceClassName)}>
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="max-w-3xl">
                      <p className="font-semibold text-foreground">Suspensión operativa</p>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedCompany?.suspendido
                          ? "Esta empresa está SUSPENDIDA. El tenant público muestra mensaje 'Cuenta suspendida' y no acepta nuevas ventas. La empresa puede seguir entrando al dashboard para contactar soporte. Distinto de dar de baja pública (self-service)."
                          : "Acción de plataforma usada para frenar la operatoria de una empresa (fraude, mora, abuso). El tenant deja de aceptar ventas y muestra mensaje de suspensión. Usar con criterio — la empresa va a notarlo al toque."}
                      </p>
                    </div>
                    <Button
                      disabled={!canManageSingletonOnly}
                      variant={selectedCompany?.suspendido ? "default" : "destructive"}
                      className="w-full lg:w-auto"
                      onClick={() => void updateCompanySuspension(!selectedCompany?.suspendido)}
                    >
                      {selectedCompany?.suspendido ? "Reactivar empresa" : "Suspender empresa"}
                    </Button>
                  </div>
                </div>
              </div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {/* 9. pendingAction confirmation Dialog */}
      <Dialog open={!!pendingAction} onOpenChange={(open) => { if (!open) setPendingAction(null) }}>
        <DialogContent
          className={cn("super-admin-theme-scope sm:max-w-md", detailDialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>{pendingAction?.label}</DialogTitle>
            <DialogDescription>{pendingAction?.description}</DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setPendingAction(null)}>Cancelar</Button>
            <Button
              variant={pendingAction?.variant ?? "destructive"}
              onClick={async () => { await pendingAction?.onConfirm(); setPendingAction(null) }}
            >
              Confirmar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 10. autoAprobar activation Dialog */}
      <Dialog open={autoAprobarDialogOpen} onOpenChange={(open) => { if (!open) setAutoAprobarDialogOpen(false) }}>
        <DialogContent
          className={cn("super-admin-theme-scope sm:max-w-md", detailDialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>Activar auto-aprobación</DialogTitle>
            <DialogDescription>
              De ahora en más, las empresas nuevas que se registren se aprueban solas y entran directo al dashboard sin tu revisión manual. Podés desactivarlo en cualquier momento.
            </DialogDescription>
          </DialogHeader>
          <label className="mt-2 flex cursor-pointer items-start gap-3 rounded-xl border border-border/50 bg-muted/20 px-4 py-3">
            <Checkbox
              className="mt-0.5"
              checked={aprobarPendientesTambien}
              onCheckedChange={(v) => setAprobarPendientesTambien(v === true)}
            />
            <span className="text-sm text-foreground">
              Aprobar también las {pendingCount} {pendingCount === 1 ? "empresa que está pendiente" : "empresas que están pendientes"} ahora
              <span className="mt-0.5 block text-xs text-muted-foreground">
                Les habilita el dashboard y les manda un email de bienvenida.
              </span>
            </span>
          </label>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setAutoAprobarDialogOpen(false)} disabled={autoAprobarSaving}>Cancelar</Button>
            <Button onClick={() => void confirmActivarAutoAprobar()} disabled={autoAprobarSaving}>
              {autoAprobarSaving ? "Activando…" : "Activar"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 11. createEmpresa Dialog */}
      <Dialog open={createDialogOpen} onOpenChange={setCreateDialogOpen}>
        <DialogContent
          className={cn("super-admin-theme-scope sm:max-w-md", detailDialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>Nueva empresa</DialogTitle>
            <DialogDescription>
              Se va a generar una contraseña temporal que vas a poder copiar al finalizar.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-3">
            <div>
              <Label className="text-xs text-muted-foreground">Nombre de la empresa</Label>
              <Input
                className="mt-1"
                placeholder="Ej: Eventos del Norte"
                value={createForm.nombre}
                onChange={(e) => {
                  const nombre = e.target.value
                  const autoSlug = nombre.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '').slice(0, 40)
                  setCreateForm((f) => ({ ...f, nombre, slug: f.slug || autoSlug }))
                }}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Slug (subdominio)</Label>
              <Input
                className="mt-1 font-mono"
                placeholder="ej: eventos-del-norte"
                value={createForm.slug}
                onChange={(e) => setCreateForm((f) => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) }))}
              />
              <p className="mt-1 text-xs text-muted-foreground">Solo minúsculas, números y guiones. 3–40 caracteres.</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Email de la empresa</Label>
              <Input className="mt-1" type="email" placeholder="admin@empresa.com" value={createForm.email} onChange={(e) => setCreateForm((f) => ({ ...f, email: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Nombre del admin</Label>
              <Input className="mt-1" placeholder="Juan" value={createForm.admin_nombre} onChange={(e) => setCreateForm((f) => ({ ...f, admin_nombre: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Apellido del admin (opcional)</Label>
              <Input className="mt-1" placeholder="Pérez" value={createForm.admin_apellido} onChange={(e) => setCreateForm((f) => ({ ...f, admin_apellido: e.target.value }))} />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" onClick={() => setCreateDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void createEmpresa()}>Crear empresa</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 12. createResult (temp password display) Dialog */}
      <Dialog open={!!createResult} onOpenChange={(open) => { if (!open) setCreateResult(null) }}>
        <DialogContent
          className={cn("super-admin-theme-scope sm:max-w-md", detailDialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>Empresa creada</DialogTitle>
            <DialogDescription>
              Copiá la contraseña temporal y pasásela a la empresa. No se va a mostrar de nuevo.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex flex-col gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="w-16 shrink-0 font-medium text-foreground">Slug</span>
              <code className="font-mono">{createResult?.slug}</code>
            </div>
            <div className="flex items-center gap-2 text-muted-foreground">
              <span className="w-16 shrink-0 font-medium text-foreground">Email</span>
              <span>{createResult?.email}</span>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3">
            <code className="flex-1 select-all font-mono text-lg tracking-widest text-foreground">
              {createResult?.temporaryPassword}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(createResult?.temporaryPassword ?? "")
                setCreateResult((prev) => prev ? { ...prev, copied: true } : prev)
              }}
            >
              {createResult?.copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setCreateResult(null)}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 13. tempPasswordResult Dialog */}
      <Dialog open={!!tempPasswordResult} onOpenChange={(open) => { if (!open) setTempPasswordResult(null) }}>
        <DialogContent
          className={cn("super-admin-theme-scope sm:max-w-md", detailDialogClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>Contraseña temporal generada</DialogTitle>
            <DialogDescription>
              Copiá esta contraseña y pasásela a la empresa. No se va a mostrar de nuevo.
            </DialogDescription>
          </DialogHeader>
          <div className="mt-2 flex items-center gap-2 rounded-xl border bg-muted/40 px-4 py-3">
            <code className="flex-1 select-all font-mono text-lg tracking-widest text-foreground">
              {tempPasswordResult?.password}
            </code>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(tempPasswordResult?.password ?? "")
                setTempPasswordResult((prev) => prev ? { ...prev, copied: true } : prev)
              }}
            >
              {tempPasswordResult?.copied ? "Copiado" : "Copiar"}
            </Button>
          </div>
          <div className="flex justify-end pt-4">
            <Button onClick={() => setTempPasswordResult(null)}>Cerrar</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
