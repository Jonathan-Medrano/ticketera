"use client"

import { useState, useMemo } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Switch } from "@/components/ui/switch"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Search, Users2, ChevronLeft, ChevronRight } from "lucide-react"
import { useLoading } from "@/components/loading-provider"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import type { PlatformBranchTreeNode, PlatformCapabilityCatalogEntry, PlatformCapabilityKey, PlatformRole, PlatformUser, PlatformViewerPolicy } from "@/components/super-admin/types"
import { formatFlowLabel, getPlatformRoleLabel, getReadinessLabel, number } from "@/components/super-admin/utils"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

const PAGE_SIZE = 12

const capabilitySections = [
  {
    title: "Navegación",
    description: "Define qué módulos puede ver en la consola.",
    keys: ["platform.users.read", "platform.companies.read", "platform.settings.read"] as PlatformCapabilityKey[],
  },
  {
    title: "Gestión",
    description: "Acciones que modifican usuarios, empresas o configuración global.",
    keys: ["platform.users.write", "platform.users.capabilities.grant", "platform.companies.overrides.edit", "platform.fees.defaults.edit"] as PlatformCapabilityKey[],
  },
  {
    title: "Revenue",
    description: "Alcance de lectura sobre métricas e ingresos.",
    keys: ["platform.revenue.view.own", "platform.revenue.view.branch", "platform.revenue.view.global"] as PlatformCapabilityKey[],
  },
  {
    title: "Notificaciones",
    description: "Recibir alertas automáticas por email cuando ocurre un error en el sistema.",
    keys: ["platform.alerts.receive"] as PlatformCapabilityKey[],
  },
] as const

const capabilityDependencies: Partial<Record<PlatformCapabilityKey, PlatformCapabilityKey[]>> = {
  "platform.users.write": ["platform.users.read"],
  "platform.users.capabilities.grant": ["platform.users.read"],
  "platform.companies.overrides.edit": ["platform.companies.read"],
  "platform.fees.defaults.edit": ["platform.settings.read"],
  "platform.revenue.view.branch": ["platform.revenue.view.own"],
  "platform.revenue.view.global": ["platform.revenue.view.own"],
}

type PlatformUsersResponse = {
  data: {
    usuarios: PlatformUser[]
    viewerPolicy: PlatformViewerPolicy
    capabilityCatalog: PlatformCapabilityCatalogEntry[]
    branchTree: PlatformBranchTreeNode[]
  }
}

type UserFormState = {
  nombre: string
  email: string
  loginAlias: string
  password: string
  roleSlug: PlatformRole["slug"]
  activo: boolean
  parentUserId: string
  capabilities: Record<PlatformCapabilityKey, boolean>
  revenueGrants: { entradas: string; consumibles: string }
}

function buildCapabilityState(user: PlatformUser | null | undefined, capabilityCatalog: PlatformCapabilityCatalogEntry[]) {
  return capabilityCatalog.reduce<Record<PlatformCapabilityKey, boolean>>((acc, capability) => {
    acc[capability.key] = Boolean(user?.capabilities?.includes(capability.key))
    return acc
  }, {} as Record<PlatformCapabilityKey, boolean>)
}

function buildForm(user: PlatformUser | null | undefined, capabilityCatalog: PlatformCapabilityCatalogEntry[], viewerPolicy: PlatformViewerPolicy): UserFormState {
  return {
    nombre: user?.nombre ?? "",
    email: user?.email ?? "",
    loginAlias: user?.loginAlias ?? "",
    password: "",
    roleSlug: user?.roleSlug ?? "staff",
    activo: user?.activo ?? true,
    parentUserId: user?.parentUserId ?? viewerPolicy.actorUserId,
    capabilities: buildCapabilityState(user, capabilityCatalog),
    revenueGrants: {
      entradas: user?.revenueGrants?.entradas?.toString() ?? user?.shareByFlow?.entradas?.toString() ?? "0",
      consumibles: user?.revenueGrants?.consumibles?.toString() ?? user?.shareByFlow?.consumibles?.toString() ?? "0",
    },
  }
}

function flattenBranchTree(nodes: PlatformBranchTreeNode[]): PlatformBranchTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenBranchTree(node.children)])
}

function getCapabilityLabel(capabilityCatalog: PlatformCapabilityCatalogEntry[], capabilityKey: PlatformCapabilityKey) {
  return capabilityCatalog.find((entry) => entry.key === capabilityKey)?.label ?? capabilityKey
}

function getOrderedCapabilitySections(capabilityCatalog: PlatformCapabilityCatalogEntry[]) {
  const byKey = new Map(capabilityCatalog.map((entry) => [entry.key, entry]))
  return capabilitySections
    .map((section) => ({
      ...section,
      items: section.keys
        .map((key) => byKey.get(key))
        .filter((entry): entry is PlatformCapabilityCatalogEntry => Boolean(entry)),
    }))
    .filter((section) => section.items.length > 0)
}

function resolveCapabilitySelection(selected: Record<PlatformCapabilityKey, boolean>, capability: PlatformCapabilityKey, checked: boolean) {
  const next = { ...selected, [capability]: checked }

  if (checked) {
    const queue = [capability]
    while (queue.length > 0) {
      const current = queue.shift()!
      for (const dependency of capabilityDependencies[current] ?? []) {
        if (next[dependency]) continue
        next[dependency] = true
        queue.push(dependency)
      }
    }
    return next
  }

  for (const [child, dependencies] of Object.entries(capabilityDependencies) as Array<[PlatformCapabilityKey, PlatformCapabilityKey[]]>) {
    if (!dependencies.includes(capability)) continue
    next[child] = false
  }

  return next
}

function canToggleCapability(capability: PlatformCapabilityKey, capabilityCeiling: Set<PlatformCapabilityKey>) {
  if (!capabilityCeiling.has(capability)) return false
  return (capabilityDependencies[capability] ?? []).every((dependency) => capabilityCeiling.has(dependency))
}

function getUserRevenueScopeLabel(user: PlatformUser) {
  const capabilities = user.capabilities ?? []
  if (capabilities.includes("platform.revenue.view.global")) return "Global"
  if (capabilities.includes("platform.revenue.view.branch")) return "Rama"
  return "Propio"
}

export default function UsuariosSection({
  initialUsers,
  initialRoles,
  initialViewerPolicy,
  initialCapabilityCatalog,
  initialBranchTree,
  canManageSingletonOnly,
  canGrantCapabilities,
}: {
  initialUsers: PlatformUser[]
  initialRoles: PlatformRole[]
  initialViewerPolicy: PlatformViewerPolicy
  initialCapabilityCatalog: PlatformCapabilityCatalogEntry[]
  initialBranchTree: PlatformBranchTreeNode[]
  canManageSingletonOnly: boolean
  canGrantCapabilities: boolean
}) {
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const [users, setUsers] = useState(initialUsers)
  const [viewerPolicy, setViewerPolicy] = useState(initialViewerPolicy)
  const [capabilityCatalog, setCapabilityCatalog] = useState(initialCapabilityCatalog)
  const [branchTree, setBranchTree] = useState(initialBranchTree)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingUser, setEditingUser] = useState<PlatformUser | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<PlatformUser | null>(null)
  const [form, setForm] = useState<UserFormState>(buildForm(undefined, initialCapabilityCatalog, initialViewerPolicy))
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState("")
  const [currentPage, setCurrentPage] = useState(1)

  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme
  const branchOptions = flattenBranchTree(branchTree)
  const capabilityCeiling = new Set(viewerPolicy.capabilityCeiling)
  const orderedCapabilitySections = getOrderedCapabilitySections(capabilityCatalog)

  // Token-based button classes — no theme branching needed; CSS vars resolve for both light and dark SA themes
  const secondaryButtonClassName = "!border !border-border !bg-card !text-foreground hover:!border-border/80 hover:!bg-muted/60"

  const dangerButtonClassName = "!border !border-destructive/30 !bg-destructive/8 !text-destructive hover:!bg-destructive/15 disabled:!border-border/50 disabled:!bg-muted/20 disabled:!text-muted-foreground"

  // Token-based surface classes — no ternary, resolves correctly for both themes
  const modalSurfaceClassName = "border-border/80 bg-popover text-popover-foreground shadow-[var(--superadmin-panel-shadow)]"
  const fieldClassName = "border-input bg-background text-foreground"
  const capabilityItemClassName = "border-border/50 bg-card text-foreground cursor-pointer"

  // Derived filtered + paginated users
  const filteredUsers = useMemo(() => {
    let result = users
    if (searchQuery) {
      const q = searchQuery.toLowerCase()
      result = result.filter((u) =>
        [u.nombre, u.email, u.loginAlias].join(" ").toLowerCase().includes(q)
      )
    }
    if (roleFilter) {
      result = result.filter((u) => u.roleSlug === roleFilter)
    }
    return result
  }, [users, searchQuery, roleFilter])

  // Reset a página 1 cuando cambia el filtro — ajuste de estado durante el
  // render (patrón oficial de React) en vez de useEffect, así evitamos el
  // flash de un frame con la página vieja que el efecto producía.
  const activeFilterKey = `${searchQuery} ${roleFilter}`
  const [prevFilterKey, setPrevFilterKey] = useState(activeFilterKey)
  if (activeFilterKey !== prevFilterKey) {
    setPrevFilterKey(activeFilterKey)
    setCurrentPage(1)
  }

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  // KPI counts derived client-side — no extra fetch
  const totalCount = users.length
  const activosCount = users.filter((u) => u.activo).length
  const inactivosCount = users.filter((u) => !u.activo).length

  const isFiltering = searchQuery !== "" || roleFilter !== ""
  const startIndex = filteredUsers.length === 0 ? 0 : (currentPage - 1) * PAGE_SIZE + 1
  const endIndex = Math.min(currentPage * PAGE_SIZE, filteredUsers.length)

  function openCreateDialog() {
    setEditingUser(null)
    setForm(buildForm(undefined, capabilityCatalog, viewerPolicy))
    setDialogOpen(true)
  }

  function openEditDialog(user: PlatformUser) {
    setEditingUser(user)
    setForm(buildForm(user, capabilityCatalog, viewerPolicy))
    setDialogOpen(true)
  }

  async function refreshUsers() {
    const res = await fetch("/api/platform/usuarios")
    const data = (await res.json()) as PlatformUsersResponse | { error?: string }
    if (!res.ok || !("data" in data)) {
      throw new Error((data as { error?: string }).error ?? "No se pudo refrescar el staff platform")
    }

    setUsers(data.data.usuarios)
    setViewerPolicy(data.data.viewerPolicy)
    setCapabilityCatalog(data.data.capabilityCatalog)
    setBranchTree(data.data.branchTree)
  }

  async function saveUser() {
    await withLoading(async () => {
      const isEdit = !!editingUser
      const payload = {
        nombre: form.nombre,
        email: form.email,
        loginAlias: form.loginAlias,
        roleSlug: form.roleSlug,
        parentUserId: form.parentUserId || null,
        capabilities: capabilityCatalog
          .filter((capability) => form.capabilities[capability.key])
          .map((capability) => capability.key),
        revenueGrants: {
          entradas: Number(form.revenueGrants.entradas || 0),
          consumibles: Number(form.revenueGrants.consumibles || 0),
        },
        activo: form.activo,
        ...(form.password ? { password: form.password } : {}),
      }

      const res = await fetch(isEdit ? `/api/platform/usuarios/${editingUser.id}` : "/api/platform/usuarios", {
        method: isEdit ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const data = (await res.json()) as { data?: { usuario: PlatformUser }; error?: string }

      if (!res.ok || !data.data) {
        toast.error(data.error ?? "No se pudo guardar el usuario platform")
        return
      }

      const savedUser = data.data.usuario

      setUsers((prev) => {
        if (isEdit) {
          return prev.map((user) => user.id === savedUser.id ? savedUser : user)
        }
        return [savedUser, ...prev]
      })
      setDialogOpen(false)
      toast.success(isEdit ? "Usuario actualizado" : "Usuario creado")
    })
  }

  async function confirmDeleteUser() {
    if (!deleteTarget) return
    const user = deleteTarget
    setDeleteTarget(null)
    await withLoading(async () => {
      const res = await fetch(`/api/platform/usuarios/${user.id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? "No se pudo eliminar el usuario")
        return
      }

      setUsers((prev) => prev.filter((candidate) => candidate.id !== user.id))
      toast.success("Usuario eliminado")
    })
  }

  return (
    <div className="space-y-4">
      {/* Zone 1: KPI strip */}
      <div className="flex flex-wrap gap-4">
        <SAKpiCard tone="neutral" className="min-w-[140px] flex-1">
          <p className={saKpiLabelCn}>Total staff</p>
          <p className={saKpiValueCn}>{totalCount}</p>
        </SAKpiCard>
        <SAKpiCard tone="success" className="min-w-[140px] flex-1">
          <p className={saKpiLabelCn}>Activos</p>
          <p className={cn(saKpiValueCn, "text-success")}>{activosCount}</p>
        </SAKpiCard>
        <SAKpiCard tone="warning" className="min-w-[140px] flex-1">
          <p className={saKpiLabelCn}>Inactivos</p>
          <p className={cn(saKpiValueCn, "text-warning")}>{inactivosCount}</p>
        </SAKpiCard>
      </div>

      {/* Zone 2: Main panel */}
      <SuperAdminPanel>
        {/* Panel header */}
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="font-semibold text-foreground">Staff platform</p>
            <p className="text-xs text-muted-foreground">Jerarquía, capabilities y revenue grants resueltos por backend.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* Search input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                className={cn("h-9 w-56 pl-9 pr-3", fieldClassName)}
                placeholder="Buscar por nombre, email o alias…"
                value={searchQuery}
                onChange={(e) => { setSearchQuery(e.target.value); setCurrentPage(1) }}
              />
            </div>
            {/* Role filter */}
            <select
              aria-label="Filtrar por rol"
              className={cn("h-9 rounded-xl border px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring", fieldClassName)}
              value={roleFilter}
              onChange={(e) => { setRoleFilter(e.target.value); setCurrentPage(1) }}
            >
              <option value="">Todos los roles</option>
              {initialRoles.map((r) => (
                <option key={r.slug} value={r.slug}>{r.nombre}</option>
              ))}
            </select>
            {/* Clear filters */}
            {isFiltering && (
              <Button
                variant="ghost"
                className="h-9 px-3 text-sm"
                onClick={() => { setSearchQuery(""); setRoleFilter(""); setCurrentPage(1) }}
              >
                Limpiar filtros
              </Button>
            )}
            <Button variant="outline" className={secondaryButtonClassName} onClick={() => withLoading(refreshUsers)}>
              Actualizar
            </Button>
            <Button
              disabled={!canManageSingletonOnly}
              className="bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground"
              onClick={openCreateDialog}
            >
              Nuevo usuario
            </Button>
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <th className="px-3 py-3">Usuario</th>
                <th className="px-3 py-3">Jerarquía</th>
                <th className="px-3 py-3">Capacidades</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {paginatedUsers.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-14 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <Users2 className="h-8 w-8 text-muted-foreground/40" />
                      {isFiltering ? (
                        <>
                          <p className="text-sm font-medium text-muted-foreground">Sin resultados</p>
                          <p className="text-xs text-muted-foreground/70">No hay usuarios que coincidan con ese criterio.</p>
                          <Button
                            variant="ghost"
                            className="mt-1 h-8 px-3 text-xs"
                            onClick={() => { setSearchQuery(""); setRoleFilter(""); setCurrentPage(1) }}
                          >
                            Limpiar filtros
                          </Button>
                        </>
                      ) : (
                        <>
                          <p className="text-sm font-medium text-muted-foreground">Sin usuarios platform</p>
                          <p className="text-xs text-muted-foreground/70">No hay staff registrado en la plataforma.</p>
                          {canManageSingletonOnly && (
                            <Button
                              className="mt-1 h-8 bg-primary px-3 text-xs text-primary-foreground hover:bg-primary/90"
                              onClick={openCreateDialog}
                            >
                              Crear primer usuario
                            </Button>
                          )}
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ) : (
                paginatedUsers.map((user) => {
                  const caps = user.capabilities ?? []
                  return (
                    <tr key={user.id} className="superadmin-row-card align-top transition hover:bg-accent/30">
                      <td className="rounded-l-2xl border-y border-l border-border/25 px-3 py-4">
                        <p className="font-semibold text-foreground">{user.nombre}</p>
                        <p className="text-xs text-muted-foreground">{user.email}</p>
                        <p className="mt-1 text-xs text-muted-foreground/80">Alias: {user.loginAlias}</p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          MP: {user.paymentAccount
                            ? getReadinessLabel({ status: user.paymentAccount.status, reason: user.paymentAccount.reason, canSell: user.paymentAccount.status === "ready_to_sell" })
                            : "Sin conectar"}
                        </p>
                      </td>
                      <td className="border-y border-border/25 px-3 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="secondary">{getPlatformRoleLabel(user.roleSlug)}</Badge>
                          {user.isSingletonSuperadmin ? <Badge>Único activo</Badge> : null}
                          <Badge variant="outline">Revenue: {getUserRevenueScopeLabel(user)}</Badge>
                        </div>
                        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
                          {!user.isSingletonSuperadmin ? (
                            <p>Grants: {number(user.revenueGrants?.entradas ?? user.shareByFlow.entradas)}% / {number(user.revenueGrants?.consumibles ?? user.shareByFlow.consumibles)}%</p>
                          ) : null}
                        </div>
                      </td>
                      <td className="border-y border-border/25 px-3 py-4">
                        <div className="flex flex-wrap gap-2">
                          {caps.length === 0 ? (
                            <span className="text-xs text-muted-foreground">Sin capabilities explícitas</span>
                          ) : caps.length > 3 ? (
                            <>
                              {caps.slice(0, 2).map((cap) => (
                                <Badge key={`${user.id}-${cap}`} variant="outline">{getCapabilityLabel(capabilityCatalog, cap)}</Badge>
                              ))}
                              <Badge variant="secondary">+{caps.length - 2} más</Badge>
                            </>
                          ) : (
                            caps.map((cap) => (
                              <Badge key={`${user.id}-${cap}`} variant="outline">{getCapabilityLabel(capabilityCatalog, cap)}</Badge>
                            ))
                          )}
                        </div>
                      </td>
                      <td className="border-y border-border/25 px-3 py-4">
                        <Badge variant={user.activo ? "default" : "secondary"}>
                          {user.activo ? "Activo" : "Inactivo"}
                        </Badge>
                      </td>
                      <td className="rounded-r-2xl border-y border-r border-border/25 px-3 py-4">
                        <div className="flex flex-wrap gap-2">
                          <Button
                            disabled={!canManageSingletonOnly}
                            variant="outline"
                            className={secondaryButtonClassName}
                            onClick={() => openEditDialog(user)}
                          >
                            Editar
                          </Button>
                          <Button
                            disabled={!canManageSingletonOnly || user.isSingletonSuperadmin}
                            variant="outline"
                            className={cn(dangerButtonClassName, user.isSingletonSuperadmin && "cursor-not-allowed opacity-50")}
                            title={user.isSingletonSuperadmin ? "No se puede eliminar el super-admin principal" : undefined}
                            onClick={() => setDeleteTarget(user)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination footer */}
        {totalPages > 1 && (
          <div className="mt-4 flex items-center justify-between text-xs text-muted-foreground">
            <span>
              Mostrando {startIndex}–{endIndex} de {filteredUsers.length} usuarios
            </span>
            <div className="flex gap-2">
              <Button
                size="icon"
                variant="outline"
                aria-label="Página anterior"
                className={cn("h-8 w-8", secondaryButtonClassName)}
                disabled={currentPage === 1}
                onClick={() => setCurrentPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                size="icon"
                variant="outline"
                aria-label="Página siguiente"
                className={cn("h-8 w-8", secondaryButtonClassName)}
                disabled={currentPage === totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </SuperAdminPanel>

      {/* Zone 3: Edit / Create Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className={cn("super-admin-theme-scope max-h-[90vh] overflow-y-auto sm:max-w-5xl", modalSurfaceClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle className="font-(family-name:var(--font-display)) text-3xl text-foreground">
              {editingUser ? "Editar usuario platform" : "Nuevo usuario platform"}
            </DialogTitle>
          </DialogHeader>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.95fr)]">
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">Nombre</Label>
                  <Input className={cn("mt-1 h-10", fieldClassName)} value={form.nombre} onChange={(e) => setForm((prev) => ({ ...prev, nombre: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Email</Label>
                  <Input className={cn("mt-1 h-10", fieldClassName)} value={form.email} onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Alias de login</Label>
                  <Input className={cn("mt-1 h-10", fieldClassName)} value={form.loginAlias} onChange={(e) => setForm((prev) => ({ ...prev, loginAlias: e.target.value }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Password {editingUser ? "(opcional)" : ""}</Label>
                  <Input className={cn("mt-1 h-10", fieldClassName)} type="password" value={form.password} onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))} />
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Capabilities delegables</Label>
                <div className="mt-2 space-y-4">
                  {orderedCapabilitySections.map((section) => (
                    <div key={section.title} className="space-y-2">
                      <div>
                        <p className="text-sm font-semibold text-foreground">{section.title}</p>
                        <p className="text-xs text-muted-foreground">{section.description}</p>
                      </div>
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                        {section.items.map((option) => (
                          <label
                            key={option.key}
                            htmlFor={option.key}
                            className={cn("flex min-h-20 items-start gap-3 rounded-xl border px-3 py-3 text-sm", capabilityItemClassName)}
                          >
                            <Checkbox
                              id={option.key}
                              checked={Boolean(form.capabilities[option.key])}
                              disabled={!canGrantCapabilities || !canToggleCapability(option.key, capabilityCeiling)}
                              onCheckedChange={(checked) => setForm((prev) => ({
                                ...prev,
                                capabilities: resolveCapabilitySelection(prev.capabilities, option.key, Boolean(checked)),
                              }))}
                              className="mt-0.5"
                            />
                            <span className="leading-snug">{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div>
                  <Label className="text-xs text-muted-foreground">% {formatFlowLabel("entradas")}</Label>
                  <Input className={cn("mt-1 h-10", fieldClassName)} value={form.revenueGrants.entradas} onChange={(e) => setForm((prev) => ({ ...prev, revenueGrants: { ...prev.revenueGrants, entradas: e.target.value } }))} />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">% {formatFlowLabel("consumibles")}</Label>
                  <Input className={cn("mt-1 h-10", fieldClassName)} value={form.revenueGrants.consumibles} onChange={(e) => setForm((prev) => ({ ...prev, revenueGrants: { ...prev.revenueGrants, consumibles: e.target.value } }))} />
                </div>
              </div>
            </div>

            <div className="space-y-4 xl:border-l xl:border-border/50 xl:pl-6">
              <div>
                <Label htmlFor="user-acceso" className="text-xs text-muted-foreground">Acceso</Label>
                <select
                  id="user-acceso"
                  className={cn("mt-1 h-10 w-full rounded-xl border px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring", fieldClassName)}
                  value={form.roleSlug}
                  onChange={(e) => setForm((prev) => ({ ...prev, roleSlug: e.target.value as PlatformRole["slug"] }))}
                >
                  {initialRoles.map((role) => (
                    <option key={role.slug} value={role.slug}>{role.nombre}</option>
                  ))}
                </select>
              </div>

              <div className={cn("flex h-10 w-full items-center gap-3 rounded-xl border px-3", fieldClassName)}>
                <Switch
                  id="activo"
                  checked={form.activo}
                  onCheckedChange={(checked) => setForm((prev) => ({ ...prev, activo: checked }))}
                />
                <Label htmlFor="activo" className="cursor-pointer text-sm">Usuario activo</Label>
              </div>

              <div>
                <Label htmlFor="user-padre" className="text-xs text-muted-foreground">Padre jerárquico</Label>
                <select
                  id="user-padre"
                  className={cn("mt-1 h-10 w-full rounded-xl border px-3 outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring", fieldClassName)}
                  value={form.parentUserId}
                  onChange={(e) => setForm((prev) => ({ ...prev, parentUserId: e.target.value }))}
                >
                  {branchOptions.map((option) => (
                    <option key={option.userId} value={option.userId}>{`${"· ".repeat(option.depth)}${option.nombre}`}</option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end pt-2">
            <Button className="min-w-48 bg-primary text-primary-foreground hover:bg-primary/90" onClick={saveUser}>
              {editingUser ? "Guardar cambios" : "Crear usuario"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation dialog */}
      <Dialog open={!!deleteTarget} onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}>
        <DialogContent
          className={cn("super-admin-theme-scope sm:max-w-md", modalSurfaceClassName)}
          data-superadmin-theme={effectiveTheme}
        >
          <DialogHeader>
            <DialogTitle>Eliminar usuario</DialogTitle>
            <DialogDescription>
              Esta acción no se puede deshacer. ¿Confirmás que querés eliminar a <strong>{deleteTarget?.nombre}</strong>?
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-3 pt-4">
            <Button variant="outline" className={secondaryButtonClassName} onClick={() => setDeleteTarget(null)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void confirmDeleteUser()}>
              Eliminar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
