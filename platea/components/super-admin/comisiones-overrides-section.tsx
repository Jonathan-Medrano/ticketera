"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { AlertCircle, Building2, CheckCircle2, Loader2, Search, Trash2, Users, X } from "lucide-react"
import { toast } from "sonner"
import { cn } from "@/lib/utils"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { getPlatformRoleLabel } from "@/components/super-admin/utils"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import type { PlatformRole } from "@/components/super-admin/types"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

// Active/inactive list-item state — single source of truth within this component
const ITEM_ACTIVE = "bg-primary/10 text-primary font-medium"
const ITEM_DEFAULT = "text-foreground/80 hover:bg-muted/60"

type Empresa = {
  id: string
  nombre: string
  slug: string
}

type TeamMember = {
  id: string
  nombre: string
  roleSlug: string
  globalShareEntradas: number
  globalShareConsumibles: number
}

type Flow = "entradas" | "consumibles"

type OverrideRow = {
  id: string
  platformAdminUserId: string
  empresaId: string
  flow: Flow
  percentage: number
  configuredByPlatformAdminId: string | null
  createdAt: string
  updatedAt: string
}

type SaveState = "idle" | "saving" | "saved" | "error"

type CellKey = `${string}__${Flow}`
function cellKey(userId: string, flow: Flow): CellKey {
  return `${userId}__${flow}` as CellKey
}

export default function ComisionesOverridesSection({
  empresas,
  teamMembers,
  canEdit,
}: {
  empresas: Empresa[]
  teamMembers: TeamMember[]
  canEdit: boolean
}) {
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme
  const [selectedEmpresaId, setSelectedEmpresaId] = useState<string | null>(empresas[0]?.id ?? null)
  const [search, setSearch] = useState("")
  const [overrides, setOverrides] = useState<OverrideRow[]>([])
  const [loadingOverrides, setLoadingOverrides] = useState(false)
  const [draftValues, setDraftValues] = useState<Record<CellKey, string>>({})
  const [saveStateByCell, setSaveStateByCell] = useState<Record<CellKey, SaveState>>({})
  const [errorByCell, setErrorByCell] = useState<Record<CellKey, string | null>>({})
  const [confirmClearAll, setConfirmClearAll] = useState(false)

  const empresasFiltradas = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return empresas
    return empresas.filter((e) => e.nombre.toLowerCase().includes(q) || e.slug.toLowerCase().includes(q))
  }, [empresas, search])

  const selectedEmpresa = useMemo(
    () => empresas.find((e) => e.id === selectedEmpresaId) ?? null,
    [empresas, selectedEmpresaId],
  )

  const overrideByCell = useMemo(() => {
    const map = new Map<CellKey, OverrideRow>()
    for (const row of overrides) {
      map.set(cellKey(row.platformAdminUserId, row.flow), row)
    }
    return map
  }, [overrides])

  const loadOverrides = useCallback(async (empresaId: string) => {
    setLoadingOverrides(true)
    try {
      const res = await fetch(`/api/platform/comisiones-overrides/empresa/${empresaId}`, { cache: "no-store" })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = (await res.json()) as { data: { overrides: OverrideRow[] } }
      setOverrides(json.data.overrides)
      setDraftValues({})
      setSaveStateByCell({})
      setErrorByCell({})
    } catch (err) {
      toast.error("Error al cargar overrides", {
        description: err instanceof Error ? err.message : "Error desconocido",
      })
      setOverrides([])
    } finally {
      setLoadingOverrides(false)
    }
  }, [])

  useEffect(() => {
    if (selectedEmpresaId) {
      void loadOverrides(selectedEmpresaId)
    } else {
      setOverrides([])
    }
  }, [selectedEmpresaId, loadOverrides])

  const setCellSaveState = useCallback((key: CellKey, state: SaveState, errMsg: string | null = null) => {
    setSaveStateByCell((prev) => ({ ...prev, [key]: state }))
    setErrorByCell((prev) => ({ ...prev, [key]: errMsg }))
  }, [])

  const handleSave = useCallback(
    async (userId: string, flow: Flow, rawValue: string) => {
      if (!selectedEmpresaId) return
      const key = cellKey(userId, flow)
      const trimmed = rawValue.trim()

      // Empty value → delete override (use global)
      if (trimmed === "") {
        const existing = overrideByCell.get(key)
        if (!existing) {
          setCellSaveState(key, "idle")
          return
        }
        setCellSaveState(key, "saving")
        try {
          const res = await fetch(
            `/api/platform/comisiones-overrides/empresa/${selectedEmpresaId}/usuario/${userId}/flow/${flow}`,
            { method: "DELETE" },
          )
          if (!res.ok && res.status !== 204) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
            throw new Error(body.error ?? `HTTP ${res.status}`)
          }
          setOverrides((prev) => prev.filter((r) => !(r.platformAdminUserId === userId && r.flow === flow)))
          setCellSaveState(key, "saved")
          setTimeout(() => setCellSaveState(key, "idle"), 1500)
        } catch (err) {
          setCellSaveState(key, "error", err instanceof Error ? err.message : "Error desconocido")
          toast.error("No se pudo guardar el override", {
            description: err instanceof Error ? err.message : undefined,
          })
        }
        return
      }

      const parsed = Number(trimmed.replace(",", "."))
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setCellSaveState(key, "error", "Debe ser un número entre 0 y 100")
        return
      }

      setCellSaveState(key, "saving")
      try {
        const res = await fetch(
          `/api/platform/comisiones-overrides/empresa/${selectedEmpresaId}/usuario/${userId}/flow/${flow}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ percentage: parsed }),
          },
        )
        if (!res.ok) {
          const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
          throw new Error(body.error ?? `HTTP ${res.status}`)
        }
        const json = (await res.json()) as { data: { override: OverrideRow } }
        setOverrides((prev) => {
          const next = prev.filter((r) => !(r.platformAdminUserId === userId && r.flow === flow))
          next.push(json.data.override)
          return next
        })
        setCellSaveState(key, "saved")
        setTimeout(() => setCellSaveState(key, "idle"), 1500)
      } catch (err) {
        setCellSaveState(key, "error", err instanceof Error ? err.message : "Error desconocido")
        toast.error("No se pudo guardar el override", {
          description: err instanceof Error ? err.message : undefined,
        })
      }
    },
    [overrideByCell, selectedEmpresaId, setCellSaveState],
  )

  const hasDirtyDrafts = useMemo(() => {
    return Object.entries(draftValues).some(([key, val]) => {
      const [userId, flow] = key.split("__") as [string, Flow]
      const existing = overrideByCell.get(cellKey(userId, flow))
      const savedVal = existing?.percentage?.toString() ?? ""
      return val.trim() !== savedVal
    })
  }, [draftValues, overrideByCell])

  const handleSaveAll = useCallback(async () => {
    const dirty = Object.entries(draftValues).filter(([key, val]) => {
      const [userId, flow] = key.split("__") as [string, Flow]
      const existing = overrideByCell.get(cellKey(userId, flow))
      const savedVal = existing?.percentage?.toString() ?? ""
      return val.trim() !== savedVal
    })
    if (dirty.length === 0) return
    await Promise.all(
      dirty.map(([key, val]) => {
        const [userId, flow] = key.split("__") as [string, Flow]
        return handleSave(userId, flow, val)
      }),
    )
  }, [draftValues, overrideByCell, handleSave])

  const handleClearAll = useCallback(async () => {
    if (!selectedEmpresaId) return
    setConfirmClearAll(false)
    for (const override of overrides) {
      setCellSaveState(cellKey(override.platformAdminUserId, override.flow), "saving")
    }
    const results = await Promise.allSettled(
      overrides.map((override) =>
        fetch(
          `/api/platform/comisiones-overrides/empresa/${selectedEmpresaId}/usuario/${override.platformAdminUserId}/flow/${override.flow}`,
          { method: "DELETE" },
        ).then(async (res) => {
          if (!res.ok && res.status !== 204) {
            const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
            throw new Error(body.error ?? `HTTP ${res.status}`)
          }
        }),
      ),
    )
    const failed = results.filter((r) => r.status === "rejected").length
    if (failed > 0) {
      toast.error(`${failed} override(s) no se pudieron eliminar`)
    } else {
      toast.success("Todos los overrides eliminados")
    }
    await loadOverrides(selectedEmpresaId)
  }, [selectedEmpresaId, overrides, loadOverrides, setCellSaveState])

  return (
    <div className="space-y-6">
      {/* 1. Section header */}
      <SuperAdminPanel className="pb-4">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Comisiones por empresa</h1>
          <p className="text-sm text-muted-foreground">
            Cada miembro del equipo cobra su <strong>% global</strong> por defecto sobre todas las empresas. Si querés que cobre un{" "}
            <strong>% distinto en una empresa puntual</strong>, configurá un override acá. El override{" "}
            <strong>reemplaza</strong> al global (no se suma).
          </p>
          {!canEdit && (
            <p className="rounded-lg border border-warning/30 bg-warning/8 px-3 py-2 text-xs text-warning">
              Solo lectura: te falta la capability{" "}
              <code className="font-mono">platform.companies.overrides.edit</code> para editar.
            </p>
          )}
        </header>
      </SuperAdminPanel>

      {/* 2. KPI / summary strip */}
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs font-medium text-muted-foreground">
          <Users className="h-3.5 w-3.5" />
          {teamMembers.length} miembro{teamMembers.length !== 1 ? "s" : ""} configurables
        </span>

        {selectedEmpresa &&
          (loadingOverrides ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              Cargando overrides…
            </span>
          ) : (
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium",
                overrides.length > 0
                  ? "border-primary/30 bg-primary/15 text-primary"
                  : "border-border bg-secondary text-muted-foreground",
              )}
            >
              {overrides.length} de {teamMembers.length} miembro{teamMembers.length !== 1 ? "s" : ""} con override
            </span>
          ))}

        <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-3 py-1 text-xs text-muted-foreground">
          Override reemplaza al global, no lo suma
        </span>
      </div>

      {/* 3. Two-panel grid */}
      <div className="grid gap-6 lg:grid-cols-[320px_1fr]">
        {/* Left panel: empresa list */}
        <SuperAdminPanel className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="search"
              aria-label="Buscar empresa"
              placeholder="Buscar empresa…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-10 w-full rounded-xl border border-input bg-background pl-9 pr-8 text-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {empresasFiltradas.length === 0 ? (
            search.trim() !== "" ? (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Search className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="font-medium">Sin resultados</p>
                <p className="mt-0.5 text-xs">Ninguna empresa coincide con &ldquo;{search}&rdquo;</p>
                <button
                  type="button"
                  onClick={() => setSearch("")}
                  className="mt-2 text-xs text-primary underline underline-offset-2 hover:no-underline"
                >
                  Limpiar búsqueda
                </button>
              </div>
            ) : (
              <div className="py-8 text-center text-sm text-muted-foreground">
                <Building2 className="mx-auto mb-2 h-8 w-8 opacity-40" />
                <p className="font-medium">No hay empresas</p>
                <p className="mt-0.5 text-xs">Cuando se registre la primera empresa aparecerá acá.</p>
              </div>
            )
          ) : (
            <ul className="max-h-[calc(100dvh-320px)] space-y-1 overflow-y-auto">
              {empresasFiltradas.map((empresa) => (
                <li key={empresa.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedEmpresaId(empresa.id)}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors",
                      selectedEmpresaId === empresa.id ? ITEM_ACTIVE : ITEM_DEFAULT,
                    )}
                  >
                    <Building2 className="h-4 w-4 shrink-0 opacity-70" />
                    <span className="flex-1 truncate">{empresa.nombre}</span>
                    {selectedEmpresaId === empresa.id && !loadingOverrides && overrides.length > 0 && (
                      <span className="shrink-0 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        {overrides.length}
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SuperAdminPanel>

        {/* Right panel: override detail */}
        <SuperAdminPanel className="space-y-4">
          {!selectedEmpresa ? (
            <div className="flex flex-col items-center justify-center py-16 text-center text-sm text-muted-foreground">
              <Building2 className="mb-3 h-8 w-8 opacity-30" />
              <p>Seleccioná una empresa para ver y editar overrides.</p>
            </div>
          ) : (
            <>
              {/* Empresa header row */}
              <div className="flex flex-col items-start justify-between gap-3 sm:flex-row">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-lg font-semibold text-foreground">{selectedEmpresa.nombre}</h2>
                    <code className="rounded bg-muted/60 px-1.5 py-0.5 font-mono text-xs text-muted-foreground">
                      {selectedEmpresa.slug}
                    </code>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span>
                      {teamMembers.length} miembro{teamMembers.length !== 1 ? "s" : ""} del equipo
                    </span>
                    {!loadingOverrides && overrides.length > 0 && (
                      <span className="inline-flex items-center rounded-full border border-primary/30 bg-primary/15 px-2 py-0.5 text-[10px] font-medium text-primary">
                        {overrides.length} override{overrides.length !== 1 ? "s" : ""} activo
                        {overrides.length !== 1 ? "s" : ""}
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex w-full shrink-0 items-center gap-2 sm:w-auto">
                  {loadingOverrides && <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />}
                  {canEdit && !loadingOverrides && hasDirtyDrafts && (
                    <Button
                      size="sm"
                      onClick={() => void handleSaveAll()}
                      className="bg-primary text-primary-foreground hover:bg-primary/90"
                      title="Cada celda se guarda sola al salir del campo. Usá este botón para forzar el guardado ahora, sin esperar."
                    >
                      Guardar ahora
                    </Button>
                  )}
                  {canEdit && !loadingOverrides && overrides.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setConfirmClearAll(true)}
                      className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Limpiar todos
                    </Button>
                  )}
                </div>
              </div>

              {teamMembers.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-sm text-muted-foreground">
                  No hay miembros de equipo activos para configurar (el superadmin no se incluye porque su share es el
                  remainder del bag).
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-border/40 text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="py-2.5 pr-3 text-left font-medium" rowSpan={2}>
                          Miembro
                        </th>
                        <th className="px-3 py-2 text-center font-medium" colSpan={2}>
                          Entradas
                        </th>
                        <th
                          className="border-l border-border/40 px-3 py-2 text-center font-medium"
                          colSpan={2}
                        >
                          Consumibles
                        </th>
                      </tr>
                      <tr className="border-b border-border/60 text-xs uppercase tracking-wider text-muted-foreground">
                        <th className="px-3 pb-2.5 text-left font-medium text-muted-foreground/60">Global</th>
                        <th className="px-3 pb-2.5 text-left font-medium">Override</th>
                        <th className="border-l border-border/40 px-3 pb-2.5 text-left font-medium text-muted-foreground/60">
                          Global
                        </th>
                        <th className="px-3 pb-2.5 text-left font-medium">Override</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loadingOverrides
                        ? [0, 1, 2].map((i) => (
                            <tr key={i} className="border-b border-border/40 last:border-b-0">
                              <td className="py-3 pr-3">
                                <div className="h-4 w-32 animate-pulse rounded bg-muted/60" />
                                <div className="mt-1.5 h-3 w-20 animate-pulse rounded bg-muted/40" />
                              </td>
                              <td className="px-3 py-3">
                                <div className="h-4 w-10 animate-pulse rounded bg-muted/60" />
                              </td>
                              <td className="px-3 py-3">
                                <div className="h-10 w-28 animate-pulse rounded-md bg-muted/60" />
                              </td>
                              <td className="border-l border-border/40 px-3 py-3">
                                <div className="h-4 w-10 animate-pulse rounded bg-muted/60" />
                              </td>
                              <td className="px-3 py-3">
                                <div className="h-10 w-28 animate-pulse rounded-md bg-muted/60" />
                              </td>
                            </tr>
                          ))
                        : teamMembers.map((member) => (
                            <tr key={member.id} className="border-b border-border/40 last:border-b-0">
                              <td className="py-3 pr-3">
                                <span className="block text-sm font-medium">{member.nombre}</span>
                                <span className="block text-xs font-normal text-muted-foreground">
                                  {getPlatformRoleLabel(member.roleSlug as PlatformRole["slug"])}
                                </span>
                              </td>
                              <td className="px-3 py-3 font-mono tabular-nums text-muted-foreground">
                                {member.globalShareEntradas}%
                              </td>
                              <OverrideCell
                                value={
                                  draftValues[cellKey(member.id, "entradas")] ??
                                  (overrideByCell.get(cellKey(member.id, "entradas"))?.percentage.toString() ?? "")
                                }
                                placeholder={`global ${member.globalShareEntradas}%`}
                                hasOverride={overrideByCell.has(cellKey(member.id, "entradas"))}
                                saveState={saveStateByCell[cellKey(member.id, "entradas")] ?? "idle"}
                                error={errorByCell[cellKey(member.id, "entradas")] ?? null}
                                canEdit={canEdit}
                                onChange={(val) =>
                                  setDraftValues((prev) => ({ ...prev, [cellKey(member.id, "entradas")]: val }))
                                }
                                onCommit={(val) => void handleSave(member.id, "entradas", val)}
                                onClear={() => {
                                  setDraftValues((prev) => ({ ...prev, [cellKey(member.id, "entradas")]: "" }))
                                  void handleSave(member.id, "entradas", "")
                                }}
                              />
                              <td className="border-l border-border/40 px-3 py-3 font-mono tabular-nums text-muted-foreground">
                                {member.globalShareConsumibles}%
                              </td>
                              <OverrideCell
                                value={
                                  draftValues[cellKey(member.id, "consumibles")] ??
                                  (overrideByCell.get(cellKey(member.id, "consumibles"))?.percentage.toString() ?? "")
                                }
                                placeholder={`global ${member.globalShareConsumibles}%`}
                                hasOverride={overrideByCell.has(cellKey(member.id, "consumibles"))}
                                saveState={saveStateByCell[cellKey(member.id, "consumibles")] ?? "idle"}
                                error={errorByCell[cellKey(member.id, "consumibles")] ?? null}
                                canEdit={canEdit}
                                onChange={(val) =>
                                  setDraftValues((prev) => ({ ...prev, [cellKey(member.id, "consumibles")]: val }))
                                }
                                onCommit={(val) => void handleSave(member.id, "consumibles", val)}
                                onClear={() => {
                                  setDraftValues((prev) => ({ ...prev, [cellKey(member.id, "consumibles")]: "" }))
                                  void handleSave(member.id, "consumibles", "")
                                }}
                              />
                            </tr>
                          ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </SuperAdminPanel>
      </div>

      {/* Confirm clear-all dialog */}
      <Dialog open={confirmClearAll} onOpenChange={setConfirmClearAll}>
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope">
          <DialogHeader>
            <DialogTitle>Eliminar todos los overrides de {selectedEmpresa?.nombre}</DialogTitle>
            <DialogDescription>
              Todos los miembros volverán a cobrar su porcentaje global en esta empresa. Esta acción no se puede
              deshacer.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmClearAll(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void handleClearAll()}>
              Eliminar todos
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function OverrideCell({
  value,
  placeholder,
  hasOverride,
  saveState,
  error,
  canEdit,
  onChange,
  onCommit,
  onClear,
}: {
  value: string
  placeholder: string
  hasOverride: boolean
  saveState: SaveState
  error: string | null
  canEdit: boolean
  onChange: (val: string) => void
  onCommit: (val: string) => void
  onClear: () => void
}) {
  return (
    <td className="px-3 py-3">
      <div className="flex items-center gap-2">
        <div className="relative">
          <input
            type="text"
            inputMode="decimal"
            disabled={!canEdit || saveState === "saving"}
            value={value}
            placeholder={placeholder}
            onChange={(e) => onChange(e.target.value)}
            onBlur={(e) => onCommit(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.currentTarget.blur()
              }
            }}
            className={cn(
              "h-10 w-28 rounded-md border bg-background px-2 pr-8 text-sm outline-none transition-colors disabled:opacity-50 focus:border-primary",
              hasOverride ? "border-primary/60 font-medium" : "border-border/60",
            )}
          />
          <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
            %
          </span>
        </div>

        {hasOverride && canEdit && saveState !== "saving" && (
          <button
            type="button"
            aria-label="Eliminar override (volver al global)"
            onClick={onClear}
            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}

        {saveState === "saving" && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        {saveState === "saved" && <CheckCircle2 className="h-4 w-4 text-success" />}
        {saveState === "error" && (
          <span title={error ?? "Error"} className="text-destructive">
            <AlertCircle className="h-4 w-4" />
          </span>
        )}
      </div>
      {saveState === "error" && error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </td>
  )
}
