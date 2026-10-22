"use client"

import { useCallback, useEffect, useState } from "react"
import { Bell, BellRing, CheckCircle2, Loader2, X } from "lucide-react"
import { toast } from "sonner"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

type Props = {
  tenantSlug: string
  eventoId: string
  categoriaId: string
  categoriaNombre: string
  fechaId?: string | null
  // Visual overrides para integrarse con el theme del tenant
  textColor?: string
  primaryColor?: string
}

type EntryStatus =
  | { state: "unknown" }
  | { state: "none" }
  | { state: "registered"; id: string; posicion: number | null }
  | { state: "assigned"; id: string; expiresAt: string | null }

export default function WaitlistButton({
  tenantSlug,
  eventoId,
  categoriaId,
  categoriaNombre,
  fechaId,
  textColor,
  primaryColor,
}: Props) {
  const [status, setStatus] = useState<EntryStatus>({ state: "unknown" })
  const [showModal, setShowModal] = useState(false)
  const [showLeaveDialog, setShowLeaveDialog] = useState(false)
  const [pendingCancelId, setPendingCancelId] = useState<string | null>(null)
  const [cantidad, setCantidad] = useState(1)
  const [saving, setSaving] = useState(false)

  const loadMyStatus = useCallback(async () => {
    try {
      const res = await fetch(`/api/tenant/${tenantSlug}/waitlist/me`, { cache: "no-store" })
      if (res.status === 401) {
        setStatus({ state: "none" })
        return
      }
      if (!res.ok) {
        setStatus({ state: "none" })
        return
      }
      type Resp = { data: { entries: Array<{ id: string; categoria_id: string; estado: string; posicion: number | null; expires_at: string | null }> } }
      const json = (await res.json()) as Resp
      const mine = json.data.entries.find((e) => e.categoria_id === categoriaId)
      if (!mine) {
        setStatus({ state: "none" })
      } else if (mine.estado === "asignado") {
        setStatus({ state: "assigned", id: mine.id, expiresAt: mine.expires_at })
      } else {
        setStatus({ state: "registered", id: mine.id, posicion: mine.posicion })
      }
    } catch {
      setStatus({ state: "none" })
    }
  }, [categoriaId, tenantSlug])

  useEffect(() => {
    void loadMyStatus()
  }, [loadMyStatus])

  const submit = useCallback(async () => {
    setSaving(true)
    try {
      const res = await fetch(`/api/tenant/${tenantSlug}/waitlist`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ evento_id: eventoId, categoria_id: categoriaId, fecha_id: fechaId ?? null, cantidad }),
      })
      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "No se pudo anotar")
        return
      }
      toast.success("¡Listo! Te avisamos por email si se libera cupo")
      setShowModal(false)
      void loadMyStatus()
    } finally {
      setSaving(false)
    }
  }, [cantidad, categoriaId, eventoId, fechaId, loadMyStatus, tenantSlug])

  const cancel = useCallback((id: string) => {
    setPendingCancelId(id)
    setShowLeaveDialog(true)
  }, [])

  const confirmLeave = useCallback(async () => {
    if (!pendingCancelId) return
    setShowLeaveDialog(false)
    const id = pendingCancelId
    setPendingCancelId(null)
    try {
      const res = await fetch(`/api/tenant/${tenantSlug}/waitlist/${id}`, { method: "DELETE" })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error ?? "Error cancelando")
        return
      }
      toast.success("Saliste de la lista de espera")
      void loadMyStatus()
    } catch {
      toast.error("Error cancelando")
    }
  }, [pendingCancelId, loadMyStatus, tenantSlug])

  // ---- Render variants ----

  if (status.state === "assigned") {
    return (
      <div className="rounded-lg border-2 border-emerald-500 bg-emerald-500/10 p-3 text-sm" style={{ color: textColor }}>
        <div className="flex items-center gap-2 font-semibold">
          <CheckCircle2 className="h-4 w-4 text-emerald-500" />
          ¡Tenés cupo disponible!
        </div>
        <p className="mt-1 text-xs opacity-80">
          Revisá tu email — te mandamos un link para completar la compra (expira en 15 min).
        </p>
      </div>
    )
  }

  if (status.state === "registered") {
    return (
      <div className="flex items-center justify-between gap-2 rounded-lg border border-current/20 bg-current/5 p-3" style={{ color: textColor }}>
        <div className="flex items-center gap-2 text-sm">
          <BellRing className="h-4 w-4" />
          <span>
            En lista de espera{status.posicion ? ` · #${status.posicion}` : ""}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void cancel(status.id)}
          className="rounded-md p-1 text-xs opacity-60 hover:opacity-100"
          title="Cancelar"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    )
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setShowModal(true)}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg border-2 px-4 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
        style={{ borderColor: textColor, color: textColor }}
      >
        <Bell className="h-4 w-4" />
        Anotarme en lista de espera
      </button>

      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lista de espera</DialogTitle>
            <DialogDescription>
              <strong className="text-card-foreground">{categoriaNombre}</strong> está agotado. Si se libera cupo, te avisamos por email con un link para comprar.
            </DialogDescription>
          </DialogHeader>

          <label className="block space-y-1">
            <span className="text-xs uppercase tracking-wider text-muted-foreground">¿Cuántas entradas necesitás?</span>
            <select
              value={cantidad}
              onChange={(e) => setCantidad(Number(e.target.value))}
              className="h-11 w-full rounded-md border border-border bg-card px-3 text-sm text-card-foreground"
            >
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowModal(false)}>
              Cancelar
            </Button>
            <Button
              onClick={() => void submit()}
              disabled={saving}
              className="h-11 gap-2 px-4 text-white"
              style={{ background: primaryColor ?? "#1ba8e7" }}
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />}
              Anotarme
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showLeaveDialog} onOpenChange={setShowLeaveDialog}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>¿Salir de la lista de espera?</DialogTitle>
            <DialogDescription>
              Vas a perder tu lugar en la lista. Si querés volver a anotarte, tendrás que empezar de nuevo.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowLeaveDialog(false)}>
              Cancelar
            </Button>
            <Button variant="destructive" onClick={() => void confirmLeave()}>
              Salir
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
