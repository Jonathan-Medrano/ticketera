"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import {
  ArrowLeft, ChevronRight, ShieldCheck, Power, Calendar, Mail, Ticket, DollarSign,
  ScanLine, ShoppingBag, UserCog, RefreshCw, Trash2, LogIn, Zap,
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import PasswordInput from "@/components/password-input"
import { formatMoney, formatDateTime } from "@/lib/format"
import { getRolLabel } from "@/components/dashboard/equipo-content"

type Usuario = {
  id: string
  nombre: string
  apellido: string | null
  email: string
  rol: string
  activo: number
  created_at: string
  porcentaje_comision: number | null
  must_change_password: number
}

type Stats = {
  total_ventas: number
  total_generado: number
  total_consumibles: number
  total_escaneos: number
}

type ActividadItem = {
  id: string
  tipo: string
  descripcion: string
  metadata: Record<string, unknown> | null
  created_at: string
}

const TIPO_CONFIG: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  empleado_creado:    { label: "Alta",                icon: UserCog,    color: "text-[color:var(--marketing-accent)] bg-[color:var(--marketing-accent-soft)]" },
  rol_cambiado:       { label: "Rol cambiado",         icon: ShieldCheck, color: "text-violet-500 bg-violet-500/15 dark:text-violet-400" },
  estado_cambiado:    { label: "Estado",               icon: Power,       color: "text-amber-500 dark:text-amber-400 bg-amber-500/15" },
  empleado_eliminado: { label: "Eliminado",            icon: Trash2,      color: "text-destructive bg-destructive/15" },
  escaneo:            { label: "Escaneo",              icon: ScanLine,    color: "text-success bg-success/15" },
  venta_consumibles:  { label: "Venta consumibles",    icon: ShoppingBag, color: "text-orange-500 dark:text-orange-400 bg-orange-500/15" },
  login:              { label: "Login",                icon: LogIn,       color: "text-[color:var(--marketing-accent)] bg-[color:var(--marketing-accent-soft)]" },
  password_reseteado: { label: "Reset de contraseña",  icon: RefreshCw,   color: "text-primary bg-primary/15" },
}

function StatCard({ icon: Icon, label, value, sub, mono = false }: { icon: React.ElementType; label: string; value: string | number; sub?: string; mono?: boolean }) {
  return (
    <div className="rounded-2xl border border-border bg-card p-5 flex items-start gap-4">
      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
        <Icon className="h-5 w-5 text-primary" />
      </div>
      <div>
        <p className="text-xs text-muted-foreground font-medium">{label}</p>
        <p className={`text-2xl font-bold text-foreground mt-0.5${mono ? " font-mono tabular-nums" : ""}`}>{value}</p>
        {sub && <p className="text-xs text-muted-foreground mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

export default function EquipoDetalleContent({
  usuario,
  stats,
  actividad,
  actividadTotal,
  canVerActividad = false,
  canEdit = false,
  canResetPassword = false,
}: {
  usuario: Usuario
  stats: Stats
  actividad: ActividadItem[]
  actividadTotal: number
  canVerActividad?: boolean
  canEdit?: boolean
  canResetPassword?: boolean
}) {
  const router = useRouter()
  const [toggleDialogOpen, setToggleDialogOpen] = useState(false)
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false)
  const [nuevaPassword, setNuevaPassword] = useState("")
  const [loading, setLoading] = useState(false)

  const iniciales = `${usuario.nombre?.[0] ?? ""}${usuario.apellido?.[0] ?? ""}`.toUpperCase()
  const rolDisplay = getRolLabel(usuario.rol)

  async function handleToggleActivo() {
    setLoading(true)
    try {
      const res = await fetch(`/api/equipo/${usuario.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ activo: usuario.activo ? 0 : 1 }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo actualizar el estado")
        return
      }
      toast.success(usuario.activo ? "Miembro desactivado" : "Miembro activado")
      setToggleDialogOpen(false)
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  async function handleResetPassword() {
    if (!nuevaPassword.trim()) {
      toast.error("Ingresá una contraseña")
      return
    }
    setLoading(true)
    try {
      const res = await fetch(`/api/equipo/${usuario.id}/password`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: nuevaPassword }),
      })
      if (!res.ok) {
        const data = await res.json()
        toast.error(data.error ?? "No se pudo resetear la contraseña")
        return
      }
      toast.success("Contraseña reseteada. El usuario deberá cambiarla en su próximo ingreso.")
      setPasswordDialogOpen(false)
      setNuevaPassword("")
      router.refresh()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-6">
      {/* Breadcrumb */}
      <nav aria-label="Navegación" className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Link href="/dashboard/equipo" className="hover:text-foreground transition-colors">Equipo</Link>
        <ChevronRight className="h-3.5 w-3.5 opacity-50" />
        <span className="text-foreground font-medium truncate max-w-xs">{usuario.nombre} {usuario.apellido ?? ""}</span>
      </nav>

      {/* Header */}
      <div className="rounded-2xl border border-border bg-card p-6 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="h-16 w-16 rounded-2xl bg-primary/10 flex items-center justify-center text-primary text-2xl font-bold shrink-0">
          {iniciales}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2 mb-1">
            <h1 className="text-2xl font-bold text-foreground">
              {usuario.nombre} {usuario.apellido ?? ""}
            </h1>
            <Badge
              variant="outline"
              className={
                usuario.activo
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-border text-muted-foreground"
              }
            >
              {usuario.activo ? "Activo" : "Inactivo"}
            </Badge>
            {usuario.must_change_password ? (
              <Badge variant="outline" className="text-amber-600 dark:text-amber-400 border-amber-300">
                <RefreshCw className="h-3 w-3 mr-1" /> Cambio de clave pendiente
              </Badge>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-1.5">
              <Mail className="h-3.5 w-3.5" />{usuario.email}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <ShieldCheck className="h-3.5 w-3.5" />{rolDisplay}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5" />Alta {formatDateTime(usuario.created_at)}
            </span>
            {usuario.porcentaje_comision != null && (
              <span className="inline-flex items-center gap-1.5">
                <Zap className="h-3.5 w-3.5" />{usuario.porcentaje_comision}% comisión
              </span>
            )}
          </div>
        </div>

        {/* Contextual action buttons */}
        {(canEdit || canResetPassword) && (
          <div className="flex flex-wrap gap-2 shrink-0">
            {canEdit && (
              <Button
                variant="outline"
                size="sm"
                className={`gap-2 ${
                  usuario.activo
                    ? "text-amber-600 dark:text-amber-400 border-amber-300 dark:border-amber-700 hover:bg-amber-500/10 hover:border-amber-400"
                    : "text-success border-success/50 hover:bg-success/5 hover:border-success/60"
                }`}
                onClick={() => setToggleDialogOpen(true)}
              >
                <Power className="h-4 w-4" />
                {usuario.activo ? "Desactivar" : "Activar"}
              </Button>
            )}
            {canResetPassword && (
              <Button
                variant="outline"
                size="sm"
                className="gap-2"
                onClick={() => setPasswordDialogOpen(true)}
              >
                <RefreshCw className="h-4 w-4" />
                Resetear contraseña
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard icon={Ticket} label="Entradas vendidas" value={stats.total_ventas} />
        <StatCard icon={DollarSign} label="Total generado" value={formatMoney(stats.total_generado)} mono />
        <StatCard icon={ScanLine} label="Escaneos" value={stats.total_escaneos} />
        <StatCard icon={ShoppingBag} label="Ventas consumibles" value={stats.total_consumibles} />
      </div>

      {/* Activity log */}
      {!canVerActividad ? (
        <div className="rounded-2xl border border-border bg-card p-6 text-center text-sm text-muted-foreground">
          No tenés permiso para ver el historial de actividad de este miembro.
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="px-6 py-4 border-b border-border flex items-center justify-between">
            <div>
              <h2 className="text-base font-semibold text-foreground">Historial de actividad</h2>
              <p className="text-xs text-muted-foreground mt-0.5">
                {actividadTotal} {actividadTotal === 1 ? "registro" : "registros"} en total
              </p>
            </div>
          </div>

          {actividad.length === 0 ? (
            <div className="px-6 py-12 text-center text-sm text-muted-foreground">
              Sin actividad registrada todavía.
            </div>
          ) : (
            <div className="divide-y divide-border">
              {actividad.map((item) => {
                const config = TIPO_CONFIG[item.tipo] ?? {
                  label: item.tipo,
                  icon: Zap,
                  color: "text-muted-foreground bg-muted",
                }
                const Icon = config.icon
                return (
                  <div key={item.id} className="flex items-start gap-4 px-6 py-4">
                    <div className={`h-8 w-8 rounded-lg flex items-center justify-center shrink-0 ${config.color}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                          {config.label}
                        </span>
                      </div>
                      <p className="text-sm text-foreground mt-0.5">{item.descripcion}</p>
                    </div>
                    <p className="text-xs text-muted-foreground shrink-0 pt-0.5">
                      {formatDateTime(item.created_at)}
                    </p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Dialog: toggle activo/inactivo */}
      <Dialog open={toggleDialogOpen} onOpenChange={(v) => { if (!v) setToggleDialogOpen(false) }}>
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">
              {usuario.activo ? "¿Desactivar miembro?" : "¿Activar miembro?"}
            </DialogTitle>
            <DialogDescription className="sr-only">Confirmar cambio de estado del miembro</DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <p className="text-sm font-semibold text-foreground mb-1">
                {usuario.nombre} {usuario.apellido ?? ""}
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {usuario.activo
                  ? "El miembro perderá acceso al dashboard hasta que vuelvas a activarlo."
                  : "El miembro va a poder acceder al dashboard nuevamente."}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => setToggleDialogOpen(false)}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                variant={usuario.activo ? "destructive" : "default"}
                className="flex-1 h-10"
                onClick={handleToggleActivo}
                disabled={loading}
              >
                {usuario.activo ? "Desactivar" : "Activar"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog: reset password */}
      <Dialog
        open={passwordDialogOpen}
        onOpenChange={(v) => {
          if (!v) {
            setPasswordDialogOpen(false)
            setNuevaPassword("")
          }
        }}
      >
        <DialogContent className="bg-card sm:max-w-sm p-6">
          <DialogHeader>
            <DialogTitle className="text-foreground">Resetear contraseña</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Ingresá la nueva contraseña para {usuario.nombre}. El usuario deberá cambiarla en su próximo ingreso.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Nueva contraseña</Label>
              <PasswordInput
                placeholder="Nueva contraseña"
                value={nuevaPassword}
                onChange={(e) => setNuevaPassword(e.target.value)}
              />
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1 h-10"
                onClick={() => {
                  setPasswordDialogOpen(false)
                  setNuevaPassword("")
                }}
                disabled={loading}
              >
                Cancelar
              </Button>
              <Button
                className="flex-1 h-10"
                onClick={handleResetPassword}
                disabled={loading || !nuevaPassword.trim()}
              >
                Confirmar reset
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}
