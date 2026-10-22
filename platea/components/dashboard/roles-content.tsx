"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"
import { useDashboardDebouncedSearch } from "@/lib/use-dashboard-debounced-search"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { IconAction } from "@/components/ui/icon-action"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Plus, ShieldCheck, Eye, Pencil, Trash2, AlertTriangle, Search, ChevronsLeft, ChevronLeft, ChevronRight, ChevronsRight, Users, KeyRound, ArrowDownUp } from "lucide-react"
import { useLoading } from "@/components/loading-provider"
import { puedeHacer, type Permisos } from "@/lib/permisos"

type RoleListItem = {
  id: string
  nombre: string
  slug: string
  es_predefinido: number
  cantidad_usuarios: number
  cantidad_permisos: number
  _error?: string
}

interface Props {
  roles: RoleListItem[]
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
  permisos?: Permisos
  esEmpleado?: boolean
}

const ORDEN_OPCIONES = [
  { value: "nombre:asc", label: "Nombre A–Z", sortBy: "nombre", sortDir: "asc" as const },
  { value: "nombre:desc", label: "Nombre Z–A", sortBy: "nombre", sortDir: "desc" as const },
  { value: "tipo:asc", label: "Tipo", sortBy: "tipo", sortDir: "asc" as const },
  { value: "usuarios:desc", label: "Usuarios", sortBy: "usuarios", sortDir: "desc" as const },
]

export default function RolesContent({ roles, pagination, permisos, esEmpleado }: Props) {
  const puede = (permiso: keyof Permisos) => puedeHacer(permiso, esEmpleado ?? false, permisos)
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { withLoading } = useLoading()
  const busqueda = searchParams.get("busqueda") ?? ""
  const sortBy = searchParams.get("sortBy") ?? "nombre"
  const sortDir = searchParams.get("sortDir") === "desc" ? "desc" : "asc"
  const pageSize = pagination.pageSize
  const rangeStart = pagination.total === 0 ? 0 : (pagination.page - 1) * pagination.pageSize + 1
  const rangeEnd = Math.min(pagination.total, pagination.page * pagination.pageSize)
  const ordenValue =
    ORDEN_OPCIONES.find((o) => o.sortBy === sortBy && o.sortDir === sortDir)?.value ??
    ORDEN_OPCIONES.find((o) => o.sortBy === sortBy)?.value ??
    "nombre:asc"

  const [modalEliminar, setModalEliminar] = useState<RoleListItem | null>(null)
  const [modalBloqueado, setModalBloqueado] = useState<RoleListItem | null>(null)
  const { value: busquedaInput, setValue: setBusquedaInput } = useDashboardDebouncedSearch({
    urlValue: busqueda,
    emit: (next) => updateQuery({ busqueda: next, page: 1 }),
  })

  function updateQuery(next: { page?: number; pageSize?: string; busqueda?: string; sortBy?: string; sortDir?: "asc" | "desc" }) {
    const params = new URLSearchParams(searchParams.toString())

    if (next.page !== undefined) params.set("page", String(next.page))

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

  function cambiarOrden(value: string) {
    const opcion = ORDEN_OPCIONES.find((o) => o.value === value)
    if (!opcion) return
    updateQuery({ sortBy: opcion.sortBy, sortDir: opcion.sortDir, page: 1 })
  }

  function intentarEliminar(rol: RoleListItem) {
    if (Number(rol.cantidad_usuarios) > 0) {
      setModalBloqueado(rol)
    } else {
      setModalEliminar(rol)
    }
  }

  async function confirmarEliminar() {
    if (!modalEliminar) return
    await withLoading(async () => {
      const res = await fetch(`/api/roles/${modalEliminar.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json()
        setModalEliminar(null)
        setModalBloqueado({ ...modalEliminar, _error: data.error ?? "No se pudo eliminar el rol" })
        return
      }
      setModalEliminar(null)
      router.refresh()
    })
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground tracking-[-0.02em]">Roles</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {pagination.total} rol{pagination.total !== 1 ? "es" : ""}
          </p>
        </div>
        {puede("crear_roles") && (
          <Button asChild className="gap-2 h-10 px-6">
            <Link href="/dashboard/roles/nuevo">
              <Plus className="h-4 w-4" /> Nuevo rol
            </Link>
          </Button>
        )}
      </div>

      {/* Toolbar */}
      <section className="rounded-2xl border border-border bg-card p-4 shadow-sm">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex flex-col gap-3 sm:flex-row xl:flex-1">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9 h-10"
                placeholder="Buscar rol por nombre o slug..."
                value={busquedaInput}
                onChange={(e) => setBusquedaInput(e.target.value)}
              />
            </div>
            <Select value={ordenValue} onValueChange={cambiarOrden}>
              <SelectTrigger className="h-10 w-full gap-2 sm:w-48">
                <span className="inline-flex items-center gap-2 text-muted-foreground">
                  <ArrowDownUp className="h-4 w-4" />
                  <SelectValue placeholder="Ordenar" />
                </span>
              </SelectTrigger>
              <SelectContent>
                {ORDEN_OPCIONES.map((opcion) => (
                  <SelectItem key={opcion.value} value={opcion.value}>{opcion.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row sm:items-center xl:justify-end">
            <Select value={String(pageSize)} onValueChange={(value) => updateQuery({ pageSize: value, page: 1 })}>
              <SelectTrigger className="h-10 w-full sm:w-20">
                <SelectValue placeholder="25" />
              </SelectTrigger>
              <SelectContent>
                {[10, 25, 50, 100].map((size) => (
                  <SelectItem key={size} value={String(size)}>{size}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <div className="flex items-center gap-2 text-sm text-muted-foreground whitespace-nowrap">
              <span className="tabular-nums">{rangeStart}–{rangeEnd}</span>
              <span>de</span>
              <span className="tabular-nums">{pagination.total}</span>
            </div>

            <div className="flex items-center gap-1">
              <IconAction label="Primera página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: 1 })} disabled={pagination.page <= 1}><ChevronsLeft className="h-4 w-4" /></IconAction>
              <IconAction label="Página anterior" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page - 1 })} disabled={pagination.page <= 1}><ChevronLeft className="h-4 w-4" /></IconAction>
              <IconAction label="Página siguiente" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.page + 1 })} disabled={pagination.page >= pagination.totalPages}><ChevronRight className="h-4 w-4" /></IconAction>
              <IconAction label="Última página" variant="ghost" size="icon-sm" onClick={() => updateQuery({ page: pagination.totalPages })} disabled={pagination.page >= pagination.totalPages}><ChevronsRight className="h-4 w-4" /></IconAction>
            </div>
          </div>
        </div>
      </section>

      {/* Grid de cards / empty state */}
      {roles.length === 0 ? (
        <div className="rounded-card border border-border bg-card px-6 py-16 text-center shadow-sm">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            <ShieldCheck className="h-6 w-6" />
          </div>
          <h3 className="font-semibold text-foreground mb-1">No hay roles</h3>
          <p className="text-muted-foreground text-sm">
            {busqueda
              ? "No se encontraron roles con ese criterio de búsqueda"
              : "Todavía no hay roles disponibles para esta empresa"}
          </p>
          {puede("crear_roles") && !busqueda ? (
            <Button asChild className="gap-2 mt-4">
              <Link href="/dashboard/roles/nuevo">
                <Plus className="h-4 w-4" /> Crear rol
              </Link>
            </Button>
          ) : null}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {roles.map((rol) => {
            const usuarios = Number(rol.cantidad_usuarios)
            const cantidadPermisos = Number(rol.cantidad_permisos)
            const esPredefinido = Boolean(rol.es_predefinido)
            return (
              <div
                key={rol.id}
                className="flex flex-col rounded-card border border-border bg-card shadow-sm transition-colors hover:border-primary/30"
              >
                <div className="flex items-start gap-3 p-4">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <ShieldCheck className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="truncate font-semibold text-foreground">{rol.nombre}</p>
                      <Badge
                        variant="outline"
                        className={`shrink-0 gap-1.5 text-[11px] ${
                          esPredefinido
                            ? "border-[color:var(--marketing-accent)]/30 bg-[color:var(--marketing-accent)]/10 text-[color:var(--marketing-accent)]"
                            : "border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-400"
                        }`}
                      >
                        {esPredefinido ? "Predefinido" : "Custom"}
                      </Badge>
                    </div>
                    <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground">{rol.slug}</p>
                  </div>
                </div>

                <div className="px-4 pb-4">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
                    <span className="inline-flex items-center gap-2">
                      <Users className="h-4 w-4 shrink-0" />
                      <span>
                        <span className="font-medium text-foreground tabular-nums">{usuarios}</span>{" "}
                        {usuarios === 1 ? "usuario" : "usuarios"}
                      </span>
                    </span>
                    <span className="inline-flex items-center gap-2">
                      <KeyRound className="h-4 w-4 shrink-0" />
                      <span>
                        <span className="font-medium text-foreground tabular-nums">{cantidadPermisos}</span>{" "}
                        {cantidadPermisos === 1 ? "permiso" : "permisos"}
                      </span>
                    </span>
                  </div>
                </div>

                <div className="mt-auto flex items-center justify-end gap-1 border-t border-border px-3 py-2">
                  <IconAction label="Ver rol" href={`/dashboard/roles/${rol.id}`} variant="ghost" size="icon-sm">
                    <Eye className="h-4 w-4" />
                  </IconAction>
                  {puede("editar_roles") && (
                    <IconAction label="Editar rol" href={`/dashboard/roles/${rol.id}/editar`} variant="ghost" size="icon-sm">
                      <Pencil className="h-4 w-4" />
                    </IconAction>
                  )}
                  {puede("eliminar_roles") && !esPredefinido && (
                    <IconAction
                      label="Eliminar rol"
                      variant="ghost"
                      size="icon-sm"
                      className="text-destructive hover:text-destructive hover:bg-destructive/10"
                      onClick={() => intentarEliminar(rol)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </IconAction>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Modal confirmar eliminación */}
      <Dialog open={!!modalEliminar} onOpenChange={(v) => { if (!v) setModalEliminar(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">¿Eliminar rol?</DialogTitle>
            <DialogDescription className="sr-only">Confirmar eliminación de rol</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-destructive/10 border border-destructive/20 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">{modalEliminar?.nombre}</p>
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

      {/* Modal bloqueado — rol con usuarios */}
      <Dialog open={!!modalBloqueado} onOpenChange={(v) => { if (!v) setModalBloqueado(null) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">No se puede eliminar</DialogTitle>
            <DialogDescription className="sr-only">El rol tiene usuarios asignados</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="flex items-start gap-3 bg-amber-500/10 border border-amber-500/30 rounded-xl p-4">
              <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-foreground mb-1">{modalBloqueado?.nombre}</p>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {modalBloqueado?._error
                    ? modalBloqueado._error
                    : `Este rol tiene ${modalBloqueado?.cantidad_usuarios} usuario${Number(modalBloqueado?.cantidad_usuarios) !== 1 ? "s" : ""} asignado${Number(modalBloqueado?.cantidad_usuarios) !== 1 ? "s" : ""}. Reasignales otro rol antes de eliminarlo.`}
                </p>
              </div>
            </div>
            <Button className="w-full h-10" onClick={() => setModalBloqueado(null)}>
              Entendido
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
