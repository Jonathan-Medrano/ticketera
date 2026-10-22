"use client"

import { useEffect, useState } from "react"
import { AlarmClock, BellRing, MessageSquare, Pencil, Search, SearchX, Trash2, X } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLoading } from "@/components/loading-provider"
import { SAKpiCard, saKpiLabelCn, saKpiValueCn } from "@/components/super-admin/kpi-card"
import { SuperAdminPanel } from "@/components/super-admin/section-shell"
import { useAppTheme, useOptionalSuperAdminTheme } from "@/components/theme-provider"
import { formatPlatformTimestamp } from "@/components/super-admin/utils"
import { toast } from "sonner"
import { cn } from "@/lib/utils"

// ---- Types ----

type MessageTipo = "info" | "warning" | "critical"
type MessageTargetType = "all" | "empresa"

export type PlatformMessage = {
  id: string
  titulo: string
  cuerpo: string
  tipo: MessageTipo
  target_type: MessageTargetType
  target_empresa_id: string | null
  activo: number
  expires_at: string | null
  created_by: string
  created_at: string
}

type MessagesResponse = { data: { messages: PlatformMessage[] } }

type Empresa = { id: string; nombre: string }

type FormState = {
  titulo: string
  cuerpo: string
  tipo: MessageTipo
  target_type: MessageTargetType
  target_empresa_id: string
  expires_at: string
}

type EditingMessage = PlatformMessage | "new" | null

// ---- Constants ----

const EMPTY_FORM: FormState = {
  titulo: "",
  cuerpo: "",
  tipo: "info",
  target_type: "all",
  target_empresa_id: "",
  expires_at: "",
}

// ---- Helpers ----

function tipoBadgeClass(tipo: MessageTipo): string {
  if (tipo === "critical")
    return "border-destructive/30 bg-destructive/15 text-destructive"
  if (tipo === "warning")
    return "border-warning/30 bg-warning/15 text-warning"
  return "border-primary/30 bg-primary/15 text-primary"
}

function tipoLabel(tipo: MessageTipo) {
  if (tipo === "critical") return "Crítico"
  if (tipo === "warning") return "Advertencia"
  return "Información"
}

// ---- Component ----

export default function MensajesSection({
  initialMessages,
}: {
  initialMessages?: PlatformMessage[]
}) {
  const { withLoading } = useLoading()
  const { resolvedTheme } = useAppTheme()
  const superAdminTheme = useOptionalSuperAdminTheme()
  const effectiveTheme = superAdminTheme?.theme ?? resolvedTheme

  const [messages, setMessages] = useState<PlatformMessage[]>(initialMessages ?? [])
  const [loading, setLoading] = useState(!initialMessages)
  const [searchQuery, setSearchQuery] = useState("")
  const [filterExpiring, setFilterExpiring] = useState(false)
  const [empresas, setEmpresas] = useState<Empresa[]>([])
  const [editingMessage, setEditingMessage] = useState<EditingMessage>(null)
  const [formState, setFormState] = useState<FormState>(EMPTY_FORM)
  const [showPreview, setShowPreview] = useState(false)
  const [pendingAction, setPendingAction] = useState<{
    label: string
    description: string
    onConfirm: () => Promise<void>
  } | null>(null)

  const empresaMap = new Map(empresas.map((e) => [e.id, e.nombre]))

  // ---- Derived KPIs ----
  // Computed before filteredMessages so the expiring filter can reuse them.
  const now = new Date()
  const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)

  const filteredMessages = messages.filter((m) => {
    if (filterExpiring) {
      if (!m.expires_at) return false
      const exp = new Date(m.expires_at)
      if (exp <= now || exp > sevenDaysLater) return false
    }
    if (!searchQuery.trim()) return true
    const q = searchQuery.trim().toLowerCase()
    return m.titulo.toLowerCase().includes(q) || m.cuerpo.toLowerCase().includes(q)
  })

  const totalCount = messages.length
  const activosCount = messages.filter((m) => m.activo === 1).length
  const porVencerCount = messages.filter((m) => {
    if (!m.expires_at) return false
    const exp = new Date(m.expires_at)
    return exp > now && exp <= sevenDaysLater
  }).length

  // ---- Data fetching ----

  async function loadMessages() {
    const res = await fetch("/api/platform/messages")
    const data = (await res.json()) as MessagesResponse | { error?: string }
    if (!res.ok || !("data" in data)) {
      toast.error((data as { error?: string }).error ?? "No se pudieron cargar los mensajes")
      return
    }
    setMessages(data.data.messages)
  }

  useEffect(() => {
    if (!initialMessages) {
      // Carga inicial de datos desde el backend (sistema externo) en el mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- async data fetch on mount, not synchronous cascade
      void loadMessages().finally(() => setLoading(false))
    }
    // Fetch empresas for Destinatario name resolution — independent of initialMessages
    fetch("/api/platform/empresas")
      .then((r) => r.json())
      .then((data: { data?: { empresas: Empresa[] } }) => {
        if (data.data?.empresas) {
          setEmpresas(data.data.empresas)
        }
      })
      .catch(() => {
        /* silently fail — UUID shown as fallback */
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync form state when dialog opens or switches message
  useEffect(() => {
    if (editingMessage === null) return
    setShowPreview(false)
    if (editingMessage === "new") {
      setFormState(EMPTY_FORM)
    } else {
      setFormState({
        titulo: editingMessage.titulo,
        cuerpo: editingMessage.cuerpo,
        tipo: editingMessage.tipo,
        target_type: editingMessage.target_type,
        target_empresa_id: editingMessage.target_empresa_id ?? "",
        // datetime-local input requires "YYYY-MM-DDTHH:mm" format (no seconds, no tz)
        expires_at: editingMessage.expires_at ? editingMessage.expires_at.slice(0, 16) : "",
      })
    }
  }, [editingMessage])

  // ---- Mutations ----

  async function submitMessage() {
    if (!formState.titulo.trim() || !formState.cuerpo.trim()) {
      toast.error("Titulo y cuerpo son requeridos")
      return
    }
    if (formState.target_type === "empresa" && !formState.target_empresa_id.trim()) {
      toast.error("Seleccioná una empresa destinataria")
      return
    }
    const isEdit = editingMessage !== null && editingMessage !== "new"
    const msgId = isEdit ? (editingMessage as PlatformMessage).id : null

    await withLoading(async () => {
      const url = isEdit ? `/api/platform/messages/${msgId}` : "/api/platform/messages"
      const method = isEdit ? "PATCH" : "POST"
      const payload = {
        titulo: formState.titulo.trim(),
        cuerpo: formState.cuerpo.trim(),
        tipo: formState.tipo,
        target_type: formState.target_type,
        target_empresa_id:
          formState.target_type === "empresa"
            ? formState.target_empresa_id || undefined
            : undefined,
        expires_at: formState.expires_at.trim() || undefined,
      }
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const json = (await res.json()) as { data?: PlatformMessage; error?: string }
      if (!res.ok) {
        toast.error(json.error ?? `Error al ${isEdit ? "actualizar" : "crear"} mensaje`)
        return
      }
      setEditingMessage(null)
      if (isEdit && msgId) {
        toast.success("Mensaje actualizado")
        await loadMessages()
      } else {
        toast.success("Mensaje creado")
        await loadMessages()
      }
    })
  }

  async function toggleActivo(message: PlatformMessage) {
    const nextActivo = message.activo !== 1
    await withLoading(async () => {
      const res = await fetch(`/api/platform/messages/${message.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: nextActivo }),
      })
      const json = (await res.json()) as { data?: unknown; error?: string }
      if (!res.ok) {
        toast.error(json.error ?? "Error al actualizar mensaje")
        return
      }
      setMessages((prev) =>
        prev.map((m) => (m.id === message.id ? { ...m, activo: nextActivo ? 1 : 0 } : m))
      )
      toast.success(nextActivo ? "Mensaje activado" : "Mensaje desactivado")
    })
  }

  function confirmDelete(message: PlatformMessage) {
    setPendingAction({
      label: "Eliminar mensaje",
      description: `Vas a eliminar permanentemente "${message.titulo}". Esta acción no se puede deshacer.`,
      onConfirm: async () => {
        await withLoading(async () => {
          const res = await fetch(`/api/platform/messages/${message.id}`, { method: "DELETE" })
          const json = (await res.json()) as { data?: unknown; error?: string }
          if (!res.ok) {
            toast.error(json.error ?? "Error al eliminar mensaje")
            return
          }
          setMessages((prev) => prev.filter((m) => m.id !== message.id))
          toast.success("Mensaje eliminado")
        })
      },
    })
  }

  // ---- Render ----

  const isEditing = editingMessage !== null && editingMessage !== "new"
  const controlClass = "border-input bg-background text-foreground"

  return (
    <div className="space-y-6">
      <SuperAdminPanel>
        {/* 1. Section header row */}
        <div className="mb-6 flex items-start justify-between gap-3">
          <div>
            <p className="text-lg font-semibold text-foreground">Mensajes de plataforma</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Avisos y comunicados visibles en el dashboard de las empresas.
            </p>
          </div>
          <Button variant="outline" onClick={() => void withLoading(loadMessages)}>
            Actualizar
          </Button>
        </div>

        {/* 2. KPI strip */}
        <div className="mb-6 flex flex-wrap gap-4">
          <SAKpiCard tone="neutral" className="flex min-w-[140px] flex-1 items-center gap-3">
            <MessageSquare className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p className={saKpiValueCn}>{totalCount}</p>
              <p className={saKpiLabelCn}>Total mensajes</p>
            </div>
          </SAKpiCard>
          <SAKpiCard tone="success" className="flex min-w-[140px] flex-1 items-center gap-3">
            <BellRing className="h-5 w-5 shrink-0 text-muted-foreground" />
            <div>
              <p
                className={cn(
                  saKpiValueCn,
                  activosCount > 0 ? "text-success" : "text-foreground"
                )}
              >
                {activosCount}
              </p>
              <p className={saKpiLabelCn}>Activos ahora</p>
            </div>
          </SAKpiCard>
          <SAKpiCard
            tone="warning"
            onClick={() => setFilterExpiring((v) => !v)}
            active={filterExpiring}
            className="flex min-w-[140px] flex-1 items-center gap-3 text-left"
          >
            <AlarmClock className={cn("h-5 w-5 shrink-0 transition-colors", filterExpiring ? "text-primary" : "text-muted-foreground")} />
            <div>
              <p
                className={cn(
                  saKpiValueCn,
                  porVencerCount > 0 ? "text-warning" : "text-foreground"
                )}
              >
                {porVencerCount}
              </p>
              <p className={saKpiLabelCn}>Vencen en 7 días</p>
            </div>
          </SAKpiCard>
        </div>

        {/* 3. Search + action bar */}
        <div className="mb-4 flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Buscar mensaje…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9 pl-9 pr-9"
            />
            {searchQuery ? (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-2 text-muted-foreground hover:text-foreground"
                aria-label="Limpiar búsqueda"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            ) : null}
          </div>
          <Button variant="default" onClick={() => setEditingMessage("new")}>
            + Nuevo mensaje
          </Button>
        </div>

        {/* 4. Messages table */}
        <div className="overflow-x-auto">
          <table className="min-w-full border-separate border-spacing-y-2 text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-[0.22em] text-muted-foreground">
                <th className="px-3 py-3">Título</th>
                <th className="px-3 py-3">Tipo</th>
                <th className="px-3 py-3">Destinatario</th>
                <th className="px-3 py-3">Expira</th>
                <th className="px-3 py-3">Estado</th>
                <th className="px-3 py-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                // Skeleton rows while loading
                Array.from({ length: 4 }).map((_, i) => (
                  <tr key={i} className="superadmin-row-card align-top">
                    <td className="w-[40%] rounded-l-2xl border-l border-transparent bg-transparent px-3 py-4">
                      <div className="mb-2 h-4 w-3/4 animate-pulse rounded-md bg-muted/40" />
                      <div className="h-3 w-full animate-pulse rounded-md bg-muted/40" />
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4">
                      <div className="h-5 w-16 animate-pulse rounded-full bg-muted/40" />
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4">
                      <div className="h-4 w-24 animate-pulse rounded-md bg-muted/40" />
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4">
                      <div className="h-4 w-20 animate-pulse rounded-md bg-muted/40" />
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4">
                      <div className="h-5 w-14 animate-pulse rounded-full bg-muted/40" />
                    </td>
                    <td className="rounded-r-2xl border-r border-transparent bg-transparent px-3 py-4">
                      <div className="flex justify-end gap-2">
                        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/40" />
                        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/40" />
                        <div className="h-8 w-8 animate-pulse rounded-lg bg-muted/40" />
                      </div>
                    </td>
                  </tr>
                ))
              ) : messages.length === 0 ? (
                // Empty state: no messages at all
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center gap-3 py-14">
                      <MessageSquare className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-foreground">
                        Sin mensajes de plataforma
                      </p>
                      <p className="max-w-xs text-center text-xs text-muted-foreground">
                        Creá un aviso para notificar a las empresas sobre mantenimientos, novedades o
                        alertas.
                      </p>
                      <Button variant="default" onClick={() => setEditingMessage("new")}>
                        + Nuevo mensaje
                      </Button>
                    </div>
                  </td>
                </tr>
              ) : filteredMessages.length === 0 ? (
                // Empty state: active filter(s) returned no results
                <tr>
                  <td colSpan={6}>
                    <div className="flex flex-col items-center gap-3 py-14">
                      <SearchX className="h-10 w-10 text-muted-foreground/40" />
                      <p className="text-sm font-medium text-foreground">
                        {filterExpiring && !searchQuery.trim()
                          ? "No hay mensajes por vencer en los próximos 7 días."
                          : <>&ldquo;{searchQuery}&rdquo;{filterExpiring ? " — sin coincidencias por vencer en 7 días" : " — sin mensajes que coincidan"}.</>}
                      </p>
                      <div className="flex gap-2">
                        {searchQuery ? (
                          <Button variant="outline" onClick={() => setSearchQuery("")}>
                            Limpiar búsqueda
                          </Button>
                        ) : null}
                        {filterExpiring ? (
                          <Button variant="outline" onClick={() => setFilterExpiring(false)}>
                            Quitar filtro
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </td>
                </tr>
              ) : (
                filteredMessages.map((msg) => (
                  <tr key={msg.id} className="superadmin-row-card align-top">
                    <td className="w-[40%] rounded-l-2xl border-l border-transparent bg-transparent px-3 py-4">
                      <p className="font-semibold text-foreground">{msg.titulo}</p>
                      <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{msg.cuerpo}</p>
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4">
                      <Badge
                        variant="outline"
                        className={cn("px-2.5 py-0.5 font-semibold", tipoBadgeClass(msg.tipo))}
                      >
                        {tipoLabel(msg.tipo)}
                      </Badge>
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4 text-sm text-muted-foreground">
                      {msg.target_type === "empresa"
                        ? (empresaMap.get(msg.target_empresa_id ?? "") ??
                          msg.target_empresa_id ??
                          "—")
                        : "Todas las empresas"}
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4 font-mono text-sm tabular-nums text-muted-foreground">
                      {formatPlatformTimestamp(msg.expires_at, "Sin vencimiento")}
                    </td>
                    <td className="border-y border-transparent bg-transparent px-3 py-4">
                      <Badge
                        variant="outline"
                        className={
                          msg.activo === 1
                            ? "border-success/30 bg-success/15 text-success"
                            : "border-border bg-secondary text-muted-foreground"
                        }
                      >
                        {msg.activo === 1 ? "Activo" : "Inactivo"}
                      </Badge>
                    </td>
                    <td className="rounded-r-2xl border-r border-transparent bg-transparent px-3 py-4">
                      <div className="flex items-center justify-end gap-2">
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          title="Editar"
                          onClick={() => setEditingMessage(msg)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            if (msg.activo === 1 && msg.tipo === "critical") {
                              setPendingAction({
                                label: "Desactivar mensaje crítico",
                                description:
                                  "Este mensaje crítico está visible en el dashboard de todas las empresas. ¿Confirmás que querés desactivarlo?",
                                onConfirm: () => toggleActivo(msg),
                              })
                            } else {
                              void toggleActivo(msg)
                            }
                          }}
                        >
                          {msg.activo === 1 ? "Desactivar" : "Activar"}
                        </Button>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8 border-destructive/30 bg-transparent text-destructive hover:bg-destructive/15"
                          title="Eliminar"
                          onClick={() => confirmDelete(msg)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </SuperAdminPanel>

      {/* 4. Create / Edit Dialog (shared, driven by editingMessage) */}
      <Dialog
        open={editingMessage !== null}
        onOpenChange={(open) => {
          if (!open) setEditingMessage(null)
        }}
      >
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope sm:max-w-lg rounded-[28px] border border-border bg-card p-6 shadow-[var(--superadmin-panel-shadow)]">
          <DialogHeader>
            <DialogTitle className="text-xl text-foreground">
              {isEditing ? "Editar mensaje" : "Nuevo mensaje de plataforma"}
            </DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {isEditing
                ? "Modificá los campos del mensaje y guardá los cambios."
                : "El mensaje aparecerá en el dashboard de las empresas seleccionadas."}
            </DialogDescription>
          </DialogHeader>

          <div className="mt-4 space-y-4">
            <div>
              <Label htmlFor="msg-titulo" className="text-xs text-muted-foreground">Título</Label>
              <Input
                id="msg-titulo"
                autoFocus
                className={cn("mt-1 h-10", controlClass)}
                value={formState.titulo}
                onChange={(e) => setFormState((p) => ({ ...p, titulo: e.target.value }))}
                placeholder="Mantenimiento programado"
              />
            </div>
            <div>
              <Label htmlFor="msg-cuerpo" className="text-xs text-muted-foreground">Cuerpo</Label>
              <textarea
                id="msg-cuerpo"
                className={cn(
                  "mt-1 w-full rounded-xl border px-3 py-2.5 text-sm outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
                  controlClass
                )}
                rows={4}
                value={formState.cuerpo}
                onChange={(e) => setFormState((p) => ({ ...p, cuerpo: e.target.value }))}
                placeholder="El sistema estará en mantenimiento el día..."
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="msg-tipo" className="text-xs text-muted-foreground">Tipo</Label>
                <select
                  id="msg-tipo"
                  className={cn(
                    "mt-1 h-10 w-full rounded-xl border px-3 text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
                    controlClass
                  )}
                  value={formState.tipo}
                  onChange={(e) =>
                    setFormState((p) => ({ ...p, tipo: e.target.value as MessageTipo }))
                  }
                >
                  <option value="info">Información</option>
                  <option value="warning">Advertencia</option>
                  <option value="critical">Crítico</option>
                </select>
              </div>
              <div>
                <Label htmlFor="msg-target" className="text-xs text-muted-foreground">Destinatario</Label>
                <select
                  id="msg-target"
                  className={cn(
                    "mt-1 h-10 w-full rounded-xl border px-3 text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
                    controlClass
                  )}
                  value={formState.target_type}
                  onChange={(e) =>
                    setFormState((p) => ({
                      ...p,
                      target_type: e.target.value as MessageTargetType,
                    }))
                  }
                >
                  <option value="all">Todas las empresas</option>
                  <option value="empresa">Empresa específica</option>
                </select>
              </div>
            </div>
            {formState.target_type === "empresa" && (
              <div>
                <Label htmlFor="msg-empresa" className="text-xs text-muted-foreground">Empresa</Label>
                {empresas.length > 0 ? (
                  <select
                    id="msg-empresa"
                    className={cn(
                      "mt-1 h-10 w-full rounded-xl border px-3 text-foreground outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring",
                      controlClass
                    )}
                    value={formState.target_empresa_id}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, target_empresa_id: e.target.value }))
                    }
                  >
                    <option value="">Seleccioná una empresa…</option>
                    {empresas.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nombre}
                      </option>
                    ))}
                  </select>
                ) : (
                  <Input
                    className={cn("mt-1 h-10", controlClass)}
                    value={formState.target_empresa_id}
                    onChange={(e) =>
                      setFormState((p) => ({ ...p, target_empresa_id: e.target.value }))
                    }
                    placeholder="UUID de la empresa"
                  />
                )}
              </div>
            )}
            <div>
              <Label className="text-xs text-muted-foreground">Expira (opcional)</Label>
              <Input
                type="datetime-local"
                className={cn("mt-1 h-10", controlClass)}
                value={formState.expires_at}
                onChange={(e) => setFormState((p) => ({ ...p, expires_at: e.target.value }))}
              />
            </div>
          </div>

          {/* Preview */}
          {showPreview && (
            <div className={cn(
              "mt-2 rounded-xl border p-4",
              formState.tipo === "critical" && "border-destructive/30 bg-destructive/15",
              formState.tipo === "warning" && "border-warning/30 bg-warning/8",
              formState.tipo === "info" && "border-primary/30 bg-primary/15",
            )}>
              <p className={cn(
                "text-xs font-bold uppercase tracking-[0.18em]",
                formState.tipo === "critical" && "text-destructive",
                formState.tipo === "warning" && "text-warning",
                formState.tipo === "info" && "text-primary",
              )}>
                {formState.tipo === "critical" ? "⚠ Crítico" : formState.tipo === "warning" ? "Advertencia" : "Información"}
              </p>
              <p className="mt-1 text-sm font-semibold text-foreground">{formState.titulo || "Sin título"}</p>
              {formState.cuerpo && <p className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{formState.cuerpo}</p>}
            </div>
          )}

          <div className="mt-4 flex items-center justify-between">
            <button
              type="button"
              onClick={() => setShowPreview((v) => !v)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground transition-colors"
            >
              {showPreview ? "Ocultar preview" : "Ver preview"}
            </button>
          </div>

          <div className="mt-3 flex gap-3">
            <Button
              className="flex-1 bg-primary text-primary-foreground hover:bg-primary/90"
              onClick={() => void submitMessage()}
            >
              {isEditing ? "Guardar cambios" : "Crear mensaje"}
            </Button>
            <Button variant="outline" onClick={() => setEditingMessage(null)}>
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* 5. Delete confirmation Dialog */}
      <Dialog
        open={!!pendingAction}
        onOpenChange={(open) => {
          if (!open) setPendingAction(null)
        }}
      >
        <DialogContent data-superadmin-theme={effectiveTheme} className="super-admin-theme-scope sm:max-w-md rounded-[28px] border border-border bg-card p-6 shadow-[var(--superadmin-panel-shadow)]">
          <DialogHeader>
            <DialogTitle className="text-xl text-foreground">{pendingAction?.label}</DialogTitle>
            <DialogDescription className="text-muted-foreground">
              {pendingAction?.description}
            </DialogDescription>
          </DialogHeader>
          <div className="mt-6 flex gap-3">
            <Button
              variant="destructive"
              className="flex-1"
              onClick={() => {
                const action = pendingAction
                setPendingAction(null)
                void action?.onConfirm()
              }}
            >
              Confirmar
            </Button>
            <Button variant="outline" onClick={() => setPendingAction(null)}>
              Cancelar
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
