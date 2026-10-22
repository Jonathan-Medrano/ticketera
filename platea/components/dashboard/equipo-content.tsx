"use client"

import { useState } from "react"
import { toast } from "sonner"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import {
  Plus,
  UserCog,
  TrendingUp,
  ShoppingBag,
  Pencil,
  Trash2,
  Power,
  AlertTriangle,
  Search,
  Columns3,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  Users,
  UserCheck,
  UserPlus,
  DollarSign,
  ExternalLink,
  Info,
  type LucideIcon,
} from "lucide-react"
import PasswordInput from "@/components/password-input"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { formatMoney, formatDate } from "@/lib/format"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { PASSWORD_POLICY_HELPER_TEXT, validatePasswordPolicy } from "@/lib/password-policy"

type EquipoUsuario = {
  id: string
  nombre: string
  apellido?: string | null
  email: string
  rol: string
  activo: number
  porcentaje_comision?: number | null
  created_at: string
  permisos?: string | Partial<Permisos> | null
}

type EquipoStat = {
  id: string
  total_ventas: number
  total_generado: number
}

type EquipoRol = {
  slug: string
  nombre: string
  es_predefinido: number
}

type PaginationMeta = {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

type Rol = string

// Color-coding por rol, prolijo y tokenizado. Las clases se aplican sobre un <Badge variant="outline">.
const rolConfigFijo: Record<string, { label: string; class: string }> = {
  admin: {
    label: "Admin",
    class: "border-[color:var(--marketing-accent)]/30 bg-[color:var(--marketing-accent)]/10 text-[color:var(--marketing-accent)]",
  },
  puerta: {
    label: "Puerta",
    class: "border-success/30 bg-success/10 text-success",
  },
  vendedor: {
    label: "Vendedor",
    class: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-400",
  },
  revendedor: {
    label: "Revendedor",
    class: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  },
  operador: {
    label: "Operador",
    class: "border-orange-500/30 bg-orange-500/10 text-orange-600 dark:text-orange-400",
  },
  barra: {
    label: "Barra",
    class: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-400",
  },
}

export function getRolLabel(slug: string): string {
  return rolConfigFijo[slug]?.label ?? (slug.charAt(0).toUpperCase() + slug.slice(1))
}

function getRolConfig(slug: string, roles: { slug: string; nombre: string }[]) {
  const rolDb = roles.find((r) => r.slug === slug)
  const fijo = rolConfigFijo[slug]
  if (fijo) {
    // Preferí el nombre friendly del array roles (de la DB); fallback al label fijo.
    return { label: rolDb?.nombre ?? fijo.label, class: fijo.class }
  }
  return {
    label: rolDb?.nombre ?? slug,
    class: "border-border bg-muted text-muted-foreground",
  }
}

// Sorts que el backend (backend/src/routes/equipo.ts, sortMap) honra de verdad vía ORDER BY SQL.
// TODOS están ordenados server-side contra columnas reales o agregados joineados (ventas/generado
// salen de un LEFT JOIN sobre entradas), así que NO hay fallback silencioso como en reconciliación.
const SORT_OPTIONS = [
  { value: "alta:desc", label: "Más recientes" },
  { value: "alta:asc", label: "Más antiguos" },
  { value: "miembro:asc", label: "Nombre (A–Z)" },
  { value: "miembro:desc", label: "Nombre (Z–A)" },
  { value: "rol:asc", label: "Rol (A–Z)" },
  { value: "ventas:desc", label: "Más ventas" },
  { value: "generado:desc", label: "Más generado" },
  { value: "comision:desc", label: "Mayor comisión" },
  { value: "estado:desc", label: "Activos primero" },
] as const

function KpiCard({
  label,
  value,
  sub,
  icon: Icon,
  tone,
  surface,
  mono = false,
}: {
  label: string
  value: string
  sub?: string
  icon: LucideIcon
  tone: string
  surface: string
  mono?: boolean
}) {
  return (
    <article className="rounded-card border border-border bg-card p-4 shadow-sm md:p-5">
      <div className={`flex h-10 w-10 items-center justify-center rounded-2xl ${surface}`}>
        <Icon className={`h-4 w-4 ${tone}`} />
      </div>
      <p className="mt-4 text-xs font-medium text-muted-foreground">{label}</p>
      <p
        className={`mt-2 text-xl font-bold tracking-[-0.04em] text-foreground tabular-nums md:text-2xl lg:text-[1.9rem] ${
          mono ? "font-mono" : ""
        }`}
      >
        {value}
      </p>
      {sub ? (
        <p className="mt-1.5 flex items-center gap-1 text-xs leading-5 text-muted-foreground">
          <Info className="h-3 w-3 shrink-0" />
          {sub}
        </p>
      ) : null}
    </article>
  )
}

interface Props {
  usuarios: EquipoUsuario[]
  stats: EquipoStat[]
  pagination: PaginationMeta
  permisos?: Permisos
  esEmpleado?: boolean
  roles: EquipoRol[]
}

const formVacioBase = {
  nombre: "",
  apellido: "",
  email: "",
  password: "",
  rol: "puerta" as Rol,
  porcentaje_comision: "",
  ver_comision_propia: true,
  ver_ganancia_propia: true,
  temporaryPassword: false,
}

export default function EquipoContent({ usuarios, stats, pagination, permisos, esEmpleado, roles }: Props) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const busqueda = searchParams.get("busqueda") ?? ""
  const sortBy = searchParams.get("sortBy") ?? "alta"
  const sortDir = searchParams.get("sortDir") === "asc" ? "asc" : "desc"
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)

  // Roles disponibles: empleados no pueden asignar admin
  const rolesDisponibles: { slug: string; nombre: string }[] = esEmpleado
    ? roles.filter((r) => r.slug !== "admin")
    : roles

  const rolInicial = rolesDisponibles.find((r) => r.slug !== "revendedor")?.slug ?? rolesDisponibles[0]?.slug ?? "puerta"
  const formVacio = { ...formVacioBase, rol: rolInicial }

  const [modalAgregar, setModalAgregar] = useState(false)
  const [form, setForm] = useState(formVacio)
  const [toggleTarget, setToggleTarget] = useState<EquipoUsuario | null>(null)

  const [modalEliminar, setModalEliminar] = useState<EquipoUsuario | null>(null)
  const [modalEditar, setModalEditar] = useState<EquipoUsuario | null>(null)
  const [columnasVisibles, setColumnasVisibles] = useState({
    rol: true,
    ventas: true,
    generado: true,
    comision: true,
    estado: true,
    alta: true,
  })
  const [formEditar, setFormEditar] = useState({
    nombre: "",
    apellido: "",
    email: "",
    rol: rolInicial,
    porcentaje_comision: "",
    ver_comision_propia: true,
    ver_ganancia_propia: true,
  })
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function cerrarAgregar() {
    setModalAgregar(false)
    setForm(formVacio)
  }

  function updateQuery(next: { page?: number; pageSize?: string; busqueda?: string; sortBy?: string; sortDir?: "asc" | "desc" }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) {
      params.set("page", String(next.page))
    }

    if (next.pageSize !== undefined) {
      if (next.pageSize) params.set("pageSize", next.pageSize)
      else params.delete("pageSize")
    }

    if (next.busqueda !== undefined) {
      writeDashboardSearchParam(params, "busqueda", next.busqueda)
    }

    if (next.sortBy !== undefined) {
      if (next.sortBy) params.set("sortBy", next.sortBy)
      else params.delete("sortBy")
    }

    if (next.sortDir !== undefined) {
      params.set("sortDir", next.sortDir)
    }

    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }

  function refreshCurrentList() {
    const query = searchParams.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
    router.refresh()
  }

  function getStat(userId: string) {
    return (
      stats.find((s) => String(s.id) === String(userId)) ?? {
        total_ventas: 0,
        total_generado: 0,
      }
    )
  }

  function abrirEditar(u: EquipoUsuario) {
    const permsActuales =
      u.permisos
        ? typeof u.permisos === "string"
          ? JSON.parse(u.permisos)
          : u.permisos
        : {}
    setFormEditar({
      nombre: u.nombre ?? "",
      apellido: u.apellido ?? "",
      email: u.email ?? "",
      rol: (u.rol as string) ?? rolInicial,
      porcentaje_comision: u.porcentaje_comision?.toString() ?? "",
      ver_comision_propia: permsActuales.ver_comision_propia ?? true,
      ver_ganancia_propia: permsActuales.ver_ganancia_propia ?? true,
    })
    setModalEditar(u)
  }

  function cerrarEditar() {
    setModalEditar(null)
    setFormEditar({
      nombre: "",
      apellido: "",
      email: "",
      rol: rolInicial,
      porcentaje_comision: "",
      ver_comision_propia: true,
      ver_ganancia_propia: true,
    })
  }

  async function handleCrear(e: React.FormEvent) {
    e.preventDefault()

    const validationError = form.temporaryPassword ? null : validatePasswordPolicy(form.password)
    if (validationError) {
      toast.error(validationError)
      return
    }
    if (form.rol === "revendedor") {
      const val = form.porcentaje_comision.trim() ? Number(form.porcentaje_comision) : null
      if (val !== null && (isNaN(val) || val < 0 || val > 100)) {
        toast.error("La comisión debe ser un número entre 0 y 100")
        return
      }
    }

    await withLoading(async () => {
      const res = await fetch("/api/equipo", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          nombre: form.nombre,
          apellido: form.apellido,
          email: form.email,
          password: form.password,
          rol: form.rol,
          porcentaje_comision:
            form.rol === "revendedor"
              ? form.porcentaje_comision.trim()
                ? Number(form.porcentaje_comision)
                : null
              : null,
          ...(form.rol === "revendedor" && {
            permisos: {
              ver_comision_propia: form.ver_comision_propia,
              ver_ganancia_propia: form.ver_ganancia_propia,
            },
          }),
          temporaryPassword: form.temporaryPassword,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al crear miembro")
        return
      }
      toast.success("Usuario creado correctamente")
      setModalAgregar(false)
      setForm(formVacio)
      refreshCurrentList()
    })
  }

  async function handleEditar(e: React.FormEvent) {
    e.preventDefault()
    if (!modalEditar) return

    if (formEditar.rol === "revendedor") {
      const val = formEditar.porcentaje_comision.trim() ? Number(formEditar.porcentaje_comision) : null
      if (val !== null && (isNaN(val) || val < 0 || val > 100)) {
        toast.error("La comisión debe ser un número entre 0 y 100")
        return
      }
    }

    await withLoading(async () => {
      const body: Record<string, unknown> = {}
      if (formEditar.nombre.trim()) body.nombre = formEditar.nombre.trim()
      body.apellido = formEditar.apellido.trim() || null
      if (formEditar.email.trim()) body.email = formEditar.email.trim()
      if (!esEmpleado) body.rol = formEditar.rol
      body.porcentaje_comision =
        formEditar.rol === "revendedor"
          ? formEditar.porcentaje_comision.trim()
            ? Number(formEditar.porcentaje_comision)
            : null
          : null
      if (formEditar.rol === "revendedor") {
        body.permisos = {
          ver_comision_propia: formEditar.ver_comision_propia,
          ver_ganancia_propia: formEditar.ver_ganancia_propia,
        }
      }

      const res = await fetch(`/api/equipo/${modalEditar.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar")
        return
      }
      toast.success("Usuario actualizado")
      setModalEditar(null)
      refreshCurrentList()
    })
  }

  async function toggleActivo(id: string, activo: boolean) {
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: activo ? 0 : 1 }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo actualizar el estado")
        return
      }
      toast.success(activo ? "Miembro desactivado" : "Miembro activado")
      refreshCurrentList()
    })
  }

  async function confirmarEliminar() {
    if (!modalEliminar) return
    await withLoading(async () => {
      const res = await fetch(`/api/equipo/${modalEliminar.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo eliminar el usuario")
        setModalEliminar(null)
        return
      }
      toast.success("Usuario eliminado")
      setModalEliminar(null)
      refreshCurrentList()
    })
  }

  async function confirmarToggle() {
    if (!toggleTarget) return
    const target = toggleTarget
    setToggleTarget(null)
    await toggleActivo(target.id, Boolean(target.activo))
  }

  // KPIs honestos. "Miembros" es lo único GLOBAL (pagination.total). El resto se calcula
  // sobre la PÁGINA visible — los stats (ventas/generado) sólo vienen de la página, por eso el sub.
  const activosPagina = usuarios.filter((u) => u.activo === 1).length
  const generadoPagina = usuarios.reduce((acc, u) => acc + Number(getStat(u.id).total_generado), 0)
  const ventasPagina = usuarios.reduce((acc, u) => acc + Number(getStat(u.id).total_ventas), 0)

  const sortValue = `${sortBy}:${sortDir}`

  return (
    <div className="space-y-5 md:space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-[-0.02em] text-foreground">Equipo</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Gestioná los miembros que acceden al dashboard, sus roles y comisiones.
          </p>
        </div>
        {puede("crear_equipo") && (
          <Button className="gap-2 h-10 px-6" onClick={() => setModalAgregar(true)}>
            <Plus className="h-4 w-4" /> Nuevo miembro
          </Button>
        )}
      </div>

      {/* Strip de KPIs — "Miembros" es global; el resto es de la página visible */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 lg:gap-4">
        <KpiCard
          label="Miembros"
          value={String(pagination.total)}
          sub="Total del equipo"
          icon={Users}
          tone="text-[color:var(--marketing-accent)]"
          surface="bg-sky-100/80"
        />
        <KpiCard
          label="Activos"
          value={String(activosPagina)}
          sub="en esta página"
          icon={UserCheck}
          tone="text-success"
          surface="bg-success/15"
        />
        <KpiCard
          label="Generado (equipo)"
          value={formatMoney(generadoPagina)}
          sub="en esta página"
          icon={DollarSign}
          tone="text-primary"
          surface="bg-primary/10"
          mono
        />
        <KpiCard
          label="Ventas (equipo)"
          value={String(ventasPagina)}
          sub="en esta página"
          icon={ShoppingBag}
          tone="text-amber-700"
          surface="bg-amber-100/80"
        />
      </section>

      {/* Lista */}
        <div className="bg-card rounded-2xl border border-border overflow-hidden shadow-sm">
          <div className="border-b border-border bg-muted/30 px-4 py-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between md:px-5">
            <div className="flex flex-col sm:flex-row gap-3 xl:flex-1">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button type="button" variant="outline" className="h-10 gap-2 bg-background xl:w-auto">
                    <Columns3 className="h-4 w-4" />
                    <span>Columnas</span>
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-56">
                  <DropdownMenuLabel>Columnas visibles</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuCheckboxItem checked={columnasVisibles.rol} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, rol: checked === true }))}>
                    Rol
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.ventas} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, ventas: checked === true }))}>
                    Ventas
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.generado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, generado: checked === true }))}>
                    Generado
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.comision} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, comision: checked === true }))}>
                    Comisión
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.estado} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, estado: checked === true }))}>
                    Estado
                  </DropdownMenuCheckboxItem>
                  <DropdownMenuCheckboxItem checked={columnasVisibles.alta} onCheckedChange={(checked) => setColumnasVisibles((prev) => ({ ...prev, alta: checked === true }))}>
                    Alta
                  </DropdownMenuCheckboxItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <div className="relative flex-1 w-full xl:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  className="pl-9 h-10 bg-background"
                  placeholder="Buscar por nombre, apellido, email o rol..."
                  value={busquedaInput}
                  onChange={(e) => setBusquedaInput(e.target.value)}
                />
              </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-3 xl:items-center xl:justify-end shrink-0">
              <Select
                value={SORT_OPTIONS.some((o) => o.value === sortValue) ? sortValue : "alta:desc"}
                onValueChange={(value) => {
                  const [nextSortBy, nextSortDir] = value.split(":")
                  updateQuery({ sortBy: nextSortBy, sortDir: nextSortDir as "asc" | "desc", page: 1 })
                }}
              >
                <SelectTrigger className="bg-background w-full sm:w-44">
                  <SelectValue placeholder="Ordenar" />
                </SelectTrigger>
                <SelectContent>
                  {SORT_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}>
                <SelectTrigger className="bg-background w-full sm:w-24">
                  <SelectValue placeholder="25" />
                </SelectTrigger>
                <SelectContent>
                  {[10, 25, 50, 100].map((size) => (
                    <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                  ))}
                </SelectContent>
              </Select>

              <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
                <span className="tabular-nums">{rangeStart}-{rangeEnd} de {pagination.total}</span>
                <Badge variant="outline" className="tabular-nums">{pagination.page}/{pagination.totalPages}</Badge>
              </div>

              <div className="flex items-center gap-1">
                <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}>
                  <ChevronsLeft className="h-4 w-4" />
                </IconAction>
                <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </IconAction>
                <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </IconAction>
                <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}>
                  <ChevronsRight className="h-4 w-4" />
                </IconAction>
              </div>
            </div>
          </div>
        {usuarios.length === 0 ? (
          <div className="px-6 py-16 text-center">
            <UserCog className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <h3 className="font-semibold text-foreground mb-1">No hay miembros</h3>
            <p className="text-muted-foreground text-sm mb-4">
              {busqueda
                ? "No se encontraron miembros con ese criterio de búsqueda"
                : "Agregá miembros para que accedan al dashboard"}
            </p>
            {puede("crear_equipo") && !busqueda && (
              <Button className="gap-2" onClick={() => setModalAgregar(true)}>
                <Plus className="h-4 w-4" /> Agregar miembro
              </Button>
            )}
          </div>
        ) : (
          <>
          <div className="relative overflow-x-auto">
            <div className="sm:hidden pointer-events-none absolute right-0 top-0 z-10 h-full w-12 bg-gradient-to-l from-card to-transparent" />
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className="px-5 py-3.5 text-left text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Miembro</th>
                  {columnasVisibles.rol && <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Rol</th>}
                  {columnasVisibles.ventas && <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Ventas</th>}
                  {columnasVisibles.generado && <th className="px-4 py-3.5 text-right text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Generado</th>}
                  {columnasVisibles.comision && <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Comisión</th>}
                  {columnasVisibles.estado && <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Estado</th>}
                  {columnasVisibles.alta && <th className="px-4 py-3.5 text-left text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Alta</th>}
                  <th className="px-5 py-3.5 text-right text-[11px] font-semibold text-primary uppercase tracking-[0.16em]">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {usuarios.map((u) => {
                  const rol = getRolConfig(u.rol as string, roles)
                  const stat = getStat(u.id)
                  const comision = u.porcentaje_comision
                  const comisionMonto = comision
                    ? (Number(stat.total_generado) * comision) / 100
                    : null

                  return (
                    <tr key={u.id} className="transition-colors hover:bg-muted/30">
                      <td className="px-5 py-4">
                        <Link href={`/dashboard/equipo/${u.id}`} className="flex items-center gap-3 group min-w-0">
                          <div className="h-9 w-9 rounded-xl bg-primary/10 flex items-center justify-center text-primary text-xs font-bold shrink-0">
                            {u.nombre?.[0]?.toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-medium text-foreground group-hover:text-primary transition-colors truncate">
                              {u.nombre} {u.apellido ?? ""}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{u.email}</p>
                          </div>
                        </Link>
                      </td>
                      {columnasVisibles.rol && <td className="px-4 py-4">
                        <Badge variant="outline" className={`text-[11px] ${rol.class}`}>
                          {rol.label}
                        </Badge>
                      </td>}
                      {columnasVisibles.ventas && <td className="px-4 py-4">
                        <div className="flex items-center gap-1.5 text-foreground tabular-nums">
                          <ShoppingBag className="h-3.5 w-3.5 text-muted-foreground" />
                          {Number(stat.total_ventas)}
                        </div>
                      </td>}
                      {columnasVisibles.generado && <td className="px-4 py-4 text-right font-mono font-medium text-foreground tabular-nums">
                        {formatMoney(Number(stat.total_generado))}
                      </td>}
                      {columnasVisibles.comision && <td className="px-4 py-4">
                        {u.rol === "revendedor" && comision != null ? (
                          <div>
                            <p className="font-mono font-medium text-foreground tabular-nums">{comision}%</p>
                            {comisionMonto !== null && (
                              <p className="text-xs text-muted-foreground flex items-center gap-1 font-mono tabular-nums">
                                <TrendingUp className="h-3 w-3" />
                                {formatMoney(comisionMonto)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>}
                      {columnasVisibles.estado && <td className="px-4 py-4">
                        <Badge
                          variant="outline"
                          className={`text-[11px] ${
                            u.activo
                              ? "border-success/30 bg-success/10 text-success"
                              : "border-border bg-muted text-muted-foreground"
                          }`}
                        >
                          {u.activo ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>}
                      {columnasVisibles.alta && <td className="px-4 py-4 text-muted-foreground text-xs whitespace-nowrap tabular-nums">
                        {formatDate(u.created_at)}
                      </td>}
                      <td className="px-5 py-4">
                        <div className="flex items-center gap-1 justify-end">
                          {u.rol === "revendedor" && (
                            <Link href={`/dashboard/revendedores/${u.id}`} title="Ver en Revendedores">
                              <ExternalLink className="h-4 w-4 text-muted-foreground hover:text-primary" />
                            </Link>
                          )}
                          {puede("editar_equipo") && (
                            <>
                              <IconAction
                                label="Editar miembro"
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => abrirEditar(u)}
                              >
                                <Pencil className="h-4 w-4" />
                              </IconAction>
                              <IconAction
                                label={u.activo ? "Desactivar" : "Activar"}
                                variant="ghost"
                                size="icon-sm"
                                className={
                                  u.activo
                                    ? "text-amber-500 dark:text-amber-400 hover:text-amber-600 dark:hover:text-amber-300 hover:bg-amber-500/10"
                                    : "text-success hover:text-success hover:bg-success/10"
                                }
                                onClick={() => setToggleTarget(u)}
                              >
                                <Power className="h-4 w-4" />
                              </IconAction>
                            </>
                          )}
                          {puede("eliminar_equipo") && (
                            <IconAction
                              label="Eliminar miembro"
                              variant="ghost"
                              size="icon-sm"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setModalEliminar(u)}
                            >
                              <Trash2 className="h-4 w-4" />
                            </IconAction>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          </>
        )}

      </div>

      {/* Modal agregar */}
      <Dialog
        open={modalAgregar}
        onOpenChange={(v) => {
          if (!v) {
            cerrarAgregar()
          } else {
            setModalAgregar(true)
          }
        }}
      >
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <DialogTitle className="text-foreground">Agregar miembro</DialogTitle>
                <DialogDescription className="text-xs">
                  Creá un acceso al dashboard con su rol y permisos.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <form onSubmit={handleCrear} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">

              <div className="space-y-1.5">
                <Label htmlFor="add-nombre" className="text-xs text-muted-foreground">Nombre</Label>
                <Input
                  id="add-nombre"
                  className="h-10"
                  placeholder="Juan"
                  value={form.nombre}
                  onChange={(e) => setForm({ ...form, nombre: e.target.value })}
                  maxLength={100}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="add-apellido" className="text-xs text-muted-foreground">
                  Apellido <span className="opacity-50">(opc.)</span>
                </Label>
                <Input
                  id="add-apellido"
                  className="h-10"
                  placeholder="García"
                  value={form.apellido}
                  onChange={(e) => setForm({ ...form, apellido: e.target.value })}
                  maxLength={100}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-email" className="text-xs text-muted-foreground">Email</Label>
              <Input
                id="add-email"
                className="h-10"
                type="email"
                placeholder="juan@empresa.com"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                maxLength={254}
                required
              />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="add-password" className="text-xs text-muted-foreground">Contraseña</Label>
              <PasswordInput
                id="add-password"
                placeholder={form.temporaryPassword ? "Contraseña temporal" : "Contraseña segura"}
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                required
              />
              <p className="text-xs text-muted-foreground">
                {form.temporaryPassword
                  ? "Excepción controlada: este usuario va a tener que cambiar la contraseña en su primer ingreso."
                  : PASSWORD_POLICY_HELPER_TEXT}
              </p>
              <label className="flex items-start gap-2 rounded-xl border border-border bg-muted/30 px-3 py-2 text-sm text-foreground">
                <Checkbox
                  className="mt-0.5"
                  checked={form.temporaryPassword}
                  onCheckedChange={(checked) => setForm({ ...form, temporaryPassword: checked === true })}
                />
                <span>Omitir validación de política de contraseña (contraseña temporal)</span>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="add-rol" className="text-xs text-muted-foreground">Rol</Label>
                <Select
                  value={form.rol}
                  onValueChange={(v) =>
                    setForm({ ...form, rol: v, porcentaje_comision: "" })
                  }
                >
                  <SelectTrigger id="add-rol" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent className="px-1.5 py-1">
                    {rolesDisponibles.map((r) => (
                      <SelectItem key={r.slug} value={r.slug}>
                        {r.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.rol === "revendedor" && (
                <div className="space-y-1.5">
                  <Label htmlFor="add-comision" className="text-xs text-muted-foreground">Comisión %</Label>
                  <div className="relative">
                    <Input
                      id="add-comision"
                      className="h-10 pr-7"
                      type="number"
                      min="0"
                      max="100"
                      placeholder="Default empresa"
                      value={form.porcentaje_comision}
                      onChange={(e) => setForm({ ...form, porcentaje_comision: e.target.value })}
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                      %
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">Dejar vacío para usar la comisión default</p>
                </div>
              )}
            </div>

            {form.rol === "revendedor" && (
              <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <Label className="text-xs font-medium text-muted-foreground">Permisos del revendedor</Label>
                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer transition-colors hover:border-primary/30">
                  <Checkbox
                    checked={form.ver_comision_propia}
                    onCheckedChange={(checked) => setForm({ ...form, ver_comision_propia: checked === true })}
                  />
                  <span className="text-sm text-foreground">Puede ver su comisión</span>
                </label>
                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer transition-colors hover:border-primary/30">
                  <Checkbox
                    checked={form.ver_ganancia_propia}
                    onCheckedChange={(checked) => setForm({ ...form, ver_ganancia_propia: checked === true })}
                  />
                  <span className="text-sm text-foreground">Puede ver sus ingresos</span>
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-10"
                onClick={cerrarAgregar}
              >
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">
                Crear miembro
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal eliminar */}
      <Dialog open={!!modalEliminar} onOpenChange={(v) => { if (!v) setModalEliminar(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar miembro?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación de miembro del equipo</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">
                  {modalEliminar?.nombre} {modalEliminar?.apellido ?? ""}
                </p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Se eliminará permanentemente. Esta acción no se puede deshacer.
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setModalEliminar(null)}>
                Cancelar
              </Button>
              <Button variant="destructive" className="flex-1 h-10" onClick={confirmarEliminar}>
                Eliminar
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal editar */}
      <Dialog
        open={!!modalEditar}
        onOpenChange={(v) => {
          if (!v) {
            cerrarEditar()
          }
        }}
      >
        <DialogContent className="bg-card max-w-md">
          <DialogHeader>
            <DialogTitle className="text-foreground">Editar miembro</DialogTitle>
            <DialogDescription className="sr-only">Editar datos del miembro del equipo</DialogDescription>
          </DialogHeader>

          {modalEditar ? (
            <div className="flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-3 py-2.5">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary font-semibold">
                {modalEditar.nombre?.[0]?.toUpperCase()}
                {modalEditar.apellido?.[0]?.toUpperCase() ?? ""}
              </div>
              <div className="min-w-0">
                <p className="truncate font-medium text-foreground">
                  {modalEditar.nombre} {modalEditar.apellido ?? ""}
                </p>
                <p className="truncate text-xs text-muted-foreground">{modalEditar.email}</p>
              </div>
            </div>
          ) : null}

          <form onSubmit={handleEditar} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="edit-nombre" className="text-xs text-muted-foreground">Nombre</Label>
                <Input
                  id="edit-nombre"
                  className="h-10"
                  value={formEditar.nombre}
                  onChange={(e) => setFormEditar({ ...formEditar, nombre: e.target.value })}
                  maxLength={100}
                  placeholder="Nombre"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="edit-apellido" className="text-xs text-muted-foreground">Apellido</Label>
                <Input
                  id="edit-apellido"
                  className="h-10"
                  value={formEditar.apellido}
                  onChange={(e) => setFormEditar({ ...formEditar, apellido: e.target.value })}
                  maxLength={100}
                  placeholder="Apellido"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-email" className="text-xs text-muted-foreground">Email</Label>
              <Input
                id="edit-email"
                type="email"
                className="h-10"
                value={formEditar.email}
                onChange={(e) => setFormEditar({ ...formEditar, email: e.target.value })}
                maxLength={254}
                placeholder="email@ejemplo.com"
              />
            </div>
            {!esEmpleado && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-rol" className="text-xs text-muted-foreground">Rol</Label>
                <Select
                  value={formEditar.rol}
                  onValueChange={(v) =>
                    setFormEditar({ ...formEditar, rol: v, porcentaje_comision: "" })
                  }
                >
                  <SelectTrigger id="edit-rol" className="h-10 w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r.slug} value={r.slug}>
                        {r.nombre}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {formEditar.rol === "revendedor" && (
              <div className="space-y-1.5">
                <Label htmlFor="edit-comision" className="text-xs text-muted-foreground">Comisión %</Label>
                <div className="relative">
                  <Input
                    id="edit-comision"
                    className="h-10 pr-7"
                    type="number"
                    min="0"
                    max="100"
                    placeholder="Default empresa"
                    value={formEditar.porcentaje_comision}
                    onChange={(e) =>
                      setFormEditar({ ...formEditar, porcentaje_comision: e.target.value })
                    }
                  />
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground text-sm">
                    %
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Dejar vacío para usar la comisión default</p>
              </div>
            )}

            {formEditar.rol === "revendedor" && (
              <div className="space-y-2 rounded-xl border border-primary/20 bg-primary/5 p-3">
                <Label className="text-xs font-medium text-muted-foreground">Permisos del revendedor</Label>
                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer transition-colors hover:border-primary/30">
                  <Checkbox
                    checked={formEditar.ver_comision_propia}
                    onCheckedChange={(checked) =>
                      setFormEditar({ ...formEditar, ver_comision_propia: checked === true })
                    }
                  />
                  <span className="text-sm text-foreground">Puede ver su comisión</span>
                </label>
                <label className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-3 py-2 cursor-pointer transition-colors hover:border-primary/30">
                  <Checkbox
                    checked={formEditar.ver_ganancia_propia}
                    onCheckedChange={(checked) =>
                      setFormEditar({ ...formEditar, ver_ganancia_propia: checked === true })
                    }
                  />
                  <span className="text-sm text-foreground">Puede ver sus ingresos</span>
                </label>
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                className="flex-1 h-10"
                onClick={cerrarEditar}
              >
                Cancelar
              </Button>
              <Button type="submit" className="flex-1 h-10">
                Guardar
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Modal confirmar toggle activo/inactivo */}
      <Dialog open={!!toggleTarget} onOpenChange={(v) => { if (!v) setToggleTarget(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {toggleTarget?.activo ? "¿Desactivar miembro?" : "¿Activar miembro?"}
            </DialogTitle>
            <DialogDescription className="sr-only">Confirmar cambio de estado del miembro</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">
                {toggleTarget?.nombre} {toggleTarget?.apellido ?? ""}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {toggleTarget?.activo
                  ? "El miembro perderá acceso al dashboard hasta que vuelvas a activarlo."
                  : "El miembro va a poder acceder al dashboard nuevamente."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 h-10" onClick={() => setToggleTarget(null)}>
                Cancelar
              </Button>
              <Button
                variant={toggleTarget?.activo ? "destructive" : "default"}
                className="flex-1 h-10"
                onClick={confirmarToggle}
              >
                {toggleTarget?.activo ? "Desactivar" : "Activar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
