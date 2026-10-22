"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { toast } from "sonner"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useLoading } from "@/components/loading-provider"
import type { Permisos } from "@/lib/permisos"
import { PERMISOS_VACIOS, esRolRevendedor } from "@/lib/permisos"
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react"

type RoleEditable = {
  id: string
  nombre: string
  permisos: string | Partial<Permisos>
}

interface ItemPermiso {
  key: keyof Permisos
  label: string
  desc?: string
}

interface GrupoPermiso {
  grupo: string
  fullWidth?: boolean
  items: ItemPermiso[]
}

const GRUPOS: GrupoPermiso[] = [
  {
    grupo: "Dashboard",
    items: [
      { key: "ver_dashboard", label: "Ver dashboard", desc: "Permite entrar al inicio del panel y consultar el resumen general de la operación." },
      { key: "ver_ingresos", label: "Ver ingresos", desc: "Habilita ver montos agregados de ventas e ingresos dentro del dashboard." },
      { key: "ver_recaudacion", label: "Ver recaudación", desc: "Muestra el detalle de recaudación comercial vinculado a eventos y ventas." },
      { key: "gestionar_reembolsos", label: "Gestionar reembolsos", desc: "Autoriza procesar, aprobar o rechazar reembolsos desde el módulo de reconciliación." },
    ],
  },
  {
    grupo: "Entradas",
    items: [
      { key: "ver_entradas", label: "Ver entradas", desc: "Da acceso al listado completo de entradas emitidas y su estado operativo." },
      { key: "ver_precios_entradas", label: "Ver precios", desc: "Permite visualizar los precios de categorías y tickets dentro del módulo de entradas." },
      { key: "ver_totales_entradas", label: "Ver totales", desc: "Expone totales y métricas económicas relacionadas con entradas vendidas." },
    ],
  },
  {
    grupo: "Consumibles",
    fullWidth: true,
    items: [
      { key: "ver_consumibles", label: "Ver consumibles", desc: "Habilita acceder al módulo de productos, barras y ventas de consumibles." },
      { key: "ver_totales_consumibles", label: "Ver totales", desc: "Permite ver totales, recaudación y métricas de ventas de consumibles." },
      { key: "gestionar_consumibles", label: "Gestionar consumibles", desc: "Autoriza crear, editar, actualizar stock y desactivar productos." },
      { key: "gestionar_stock_barras", label: "Gestionar stock de barras", desc: "Permite ajustar stock de barras y gestionar alertas de restock." },
      { key: "gestionar_promociones", label: "Gestionar promociones", desc: "Autoriza crear, editar y eliminar promociones de consumibles." },
      { key: "vender_consumibles", label: "Vender consumibles", desc: "Permite registrar ventas de consumibles desde barra o punto de venta." },
      { key: "canjear_consumibles", label: "Canjear consumibles", desc: "Habilita validar, entregar o canjear tickets de consumibles vendidos." },
    ],
  },
  {
    grupo: "Eventos",
    fullWidth: true,
    items: [
      { key: "ver_eventos", label: "Ver eventos", desc: "Permite listar y consultar todos los eventos cargados por la empresa." },
      { key: "ver_kpis_eventos", label: "Ver KPIs de eventos", desc: "Permite ver ingresos netos, ticket promedio y ventas de los últimos 7 días por cada evento en la lista." },
      { key: "crear_eventos", label: "Crear eventos", desc: "Autoriza crear eventos nuevos con fechas, tandas y categorías." },
      { key: "editar_eventos", label: "Editar eventos", desc: "Permite modificar datos, imágenes, categorías y estructura de eventos existentes." },
      { key: "activar_eventos", label: "Activar / desactivar", desc: "Permite publicar, pausar o reactivar eventos según su estado comercial." },
      { key: "eliminar_eventos", label: "Eliminar eventos", desc: "Autoriza borrar eventos del sistema de forma permanente." },
    ],
  },
  {
    grupo: "Compradores",
    fullWidth: true,
    items: [
      { key: "ver_compradores", label: "Ver compradores", desc: "Da acceso al listado, detalle e historial básico de compradores." },
      { key: "ver_montos_compradores", label: "Ver montos", desc: "Habilita ver cuánto gastó cada comprador y sus importes históricos." },
      { key: "cambiar_password_compradores", label: "Cambiar contraseña", desc: "Permite resetear o reemplazar la contraseña de acceso de un comprador." },
      { key: "ingresar_como_comprador", label: "Ingresar como comprador", desc: "Autoriza ingresar al portal simulando la identidad del comprador." },
    ],
  },
  {
    grupo: "Equipo",
    items: [
      { key: "ver_equipo", label: "Ver equipo", desc: "Permite consultar la nómina de usuarios internos y sus roles asignados." },
      { key: "ver_actividad_equipo", label: "Ver actividad del equipo", desc: "Permite ver el historial de acciones de cada miembro: escaneos, ventas, cambios de rol y más." },
      { key: "crear_equipo", label: "Crear miembros", desc: "Autoriza dar de alta nuevos usuarios internos dentro de la empresa." },
      { key: "editar_equipo", label: "Editar miembros", desc: "Permite cambiar datos, rol y permisos de miembros existentes." },
      { key: "eliminar_equipo", label: "Eliminar miembros", desc: "Autoriza eliminar cuentas internas del equipo de forma permanente." },
    ],
  },
  {
    grupo: "Roles",
    items: [
      { key: "ver_roles", label: "Ver roles", desc: "Da acceso al módulo donde se consultan roles y matrices de permisos." },
      { key: "crear_roles", label: "Crear roles", desc: "Permite crear roles personalizados para distintos perfiles del equipo." },
      { key: "editar_roles", label: "Editar roles", desc: "Autoriza modificar permisos y configuración de roles existentes." },
      { key: "eliminar_roles", label: "Eliminar roles", desc: "Permite borrar roles personalizados que no estén protegidos ni asignados." },
    ],
  },
  {
    grupo: "Revendedores",
    items: [
      { key: "gestionar_revendedores", label: "Gestionar revendedores", desc: "Autoriza crear, editar, activar o desactivar revendedores de la empresa." },
    ],
  },
  {
    grupo: "Marketing",
    items: [
      { key: "ver_marketing", label: "Ver marketing", desc: "Da acceso al módulo de marketing, campañas y comunicaciones de la empresa." },
      { key: "gestionar_codigos", label: "Gestionar códigos de descuento", desc: "Autoriza crear, editar y desactivar códigos de descuento de la empresa." },
      { key: "gestionar_campanas", label: "Gestionar campañas", desc: "Autoriza crear, editar y borrar campañas de email, segmentos y configurar el remitente." },
      { key: "enviar_campanas", label: "Enviar campañas", desc: "Permite disparar el envío de una campaña a los destinatarios. Requiere 'Gestionar campañas'." },
      { key: "gestionar_analitica", label: "Gestionar analítica", desc: "Autoriza configurar GA4, Meta Pixel, GTM y conectar la cuenta de Google." },
      { key: "gestionar_marketing", label: "Gestionar marketing (completo)", desc: "Acceso total al módulo: equivale a tener los cuatro permisos de marketing a la vez. Útil para roles de marketing sin restricciones." },
    ],
  },
  {
    grupo: "Revendedor personal",
    items: [
      { key: "ver_comision_propia", label: "Ver comisión propia", desc: "Permite al revendedor consultar su porcentaje de comisión asignado." },
      { key: "ver_ganancia_propia", label: "Ver ganancia propia", desc: "Habilita al revendedor a ver sus ingresos y totales generados por sus ventas." },
    ],
  },
  {
    grupo: "Otros",
    items: [
      { key: "escanear", label: "Escanear entradas", desc: "Habilita usar el lector/escáner de entradas en accesos y puerta." },
      { key: "exportar", label: "Exportar datos", desc: "Permite exportar listados a CSV desde cualquier sección del panel: entradas, compradores, reembolsos, consumibles, eventos y más." },
      { key: "ver_configuracion", label: "Ver configuración", desc: "Permite consultar la configuración general y comercial de la empresa." },
      { key: "editar_configuracion", label: "Editar configuración", desc: "Autoriza cambiar ajustes internos, comerciales y operativos de la empresa. Requerido para acceder al editor de sitio de venta." },
    ],
  },
]

const PERMISSION_DEPENDENCIES: Array<{ key: keyof Permisos; requires: keyof Permisos; label: string; requiresLabel: string }> = [
  { key: "ver_ingresos", requires: "ver_dashboard", label: "Ver ingresos", requiresLabel: "Ver dashboard" },
  { key: "ver_recaudacion", requires: "ver_dashboard", label: "Ver recaudación", requiresLabel: "Ver dashboard" },
  { key: "ver_kpis_eventos", requires: "ver_eventos", label: "Ver KPIs de eventos", requiresLabel: "Ver eventos" },
  { key: "crear_eventos", requires: "ver_eventos", label: "Crear eventos", requiresLabel: "Ver eventos" },
  { key: "editar_eventos", requires: "ver_eventos", label: "Editar eventos", requiresLabel: "Ver eventos" },
  { key: "activar_eventos", requires: "ver_eventos", label: "Activar / desactivar", requiresLabel: "Ver eventos" },
  { key: "eliminar_eventos", requires: "ver_eventos", label: "Eliminar eventos", requiresLabel: "Ver eventos" },
  { key: "ver_precios_entradas", requires: "ver_entradas", label: "Ver precios", requiresLabel: "Ver entradas" },
  { key: "ver_totales_entradas", requires: "ver_entradas", label: "Ver totales", requiresLabel: "Ver entradas" },
  { key: "ver_montos_compradores", requires: "ver_compradores", label: "Ver montos", requiresLabel: "Ver compradores" },
  { key: "cambiar_password_compradores", requires: "ver_compradores", label: "Cambiar contraseña", requiresLabel: "Ver compradores" },
  { key: "ingresar_como_comprador", requires: "ver_compradores", label: "Ingresar como comprador", requiresLabel: "Ver compradores" },
  { key: "ver_actividad_equipo", requires: "ver_equipo", label: "Ver actividad del equipo", requiresLabel: "Ver equipo" },
  { key: "crear_equipo", requires: "ver_equipo", label: "Crear miembros", requiresLabel: "Ver equipo" },
  { key: "editar_equipo", requires: "ver_equipo", label: "Editar miembros", requiresLabel: "Ver equipo" },
  { key: "eliminar_equipo", requires: "ver_equipo", label: "Eliminar miembros", requiresLabel: "Ver equipo" },
  { key: "crear_roles", requires: "ver_roles", label: "Crear roles", requiresLabel: "Ver roles" },
  { key: "editar_roles", requires: "ver_roles", label: "Editar roles", requiresLabel: "Ver roles" },
  { key: "eliminar_roles", requires: "ver_roles", label: "Eliminar roles", requiresLabel: "Ver roles" },
  { key: "editar_configuracion", requires: "ver_configuracion", label: "Editar configuración", requiresLabel: "Ver configuración" },
  { key: "ver_totales_consumibles", requires: "ver_consumibles", label: "Ver totales", requiresLabel: "Ver consumibles" },
  { key: "gestionar_consumibles", requires: "ver_consumibles", label: "Gestionar consumibles", requiresLabel: "Ver consumibles" },
  { key: "gestionar_stock_barras", requires: "ver_consumibles", label: "Gestionar stock de barras", requiresLabel: "Ver consumibles" },
  { key: "gestionar_promociones", requires: "ver_consumibles", label: "Gestionar promociones", requiresLabel: "Ver consumibles" },
  { key: "vender_consumibles", requires: "ver_consumibles", label: "Vender consumibles", requiresLabel: "Ver consumibles" },
  { key: "canjear_consumibles", requires: "ver_consumibles", label: "Canjear consumibles", requiresLabel: "Ver consumibles" },
  { key: "gestionar_reembolsos", requires: "ver_recaudacion", label: "Gestionar reembolsos", requiresLabel: "Ver recaudación" },
  { key: "gestionar_marketing", requires: "ver_marketing", label: "Gestionar marketing (completo)", requiresLabel: "Ver marketing" },
  { key: "gestionar_codigos", requires: "ver_marketing", label: "Gestionar códigos de descuento", requiresLabel: "Ver marketing" },
  { key: "gestionar_campanas", requires: "ver_marketing", label: "Gestionar campañas", requiresLabel: "Ver marketing" },
  { key: "enviar_campanas", requires: "gestionar_campanas", label: "Enviar campañas", requiresLabel: "Gestionar campañas" },
  { key: "gestionar_analitica", requires: "ver_marketing", label: "Gestionar analítica", requiresLabel: "Ver marketing" },
]

interface Props {
  modo: "crear" | "editar" | "ver"
  rol?: RoleEditable
}

export default function RolFormContent({ modo, rol }: Props) {
  const router = useRouter()
  const { withLoading } = useLoading()

  const permisosIniciales: Permisos = (() => {
    if (modo !== "crear" && rol?.permisos) {
      try {
        return typeof rol.permisos === "string" ? JSON.parse(rol.permisos) : rol.permisos
      } catch {
        return { ...PERMISOS_VACIOS }
      }
    }
    return { ...PERMISOS_VACIOS }
  })()

  const [nombre, setNombre] = useState(modo === "crear" ? "" : rol?.nombre ?? "")
  const [permisosForm, setPermisosForm] = useState<Permisos>(permisosIniciales)
  const esSoloLectura = modo === "ver"

  // Misma heurística que usan proxy.ts / dashboard-auth.ts / revendedor/layout.tsx
  // para decidir si un empleado es tratado como revendedor. La corremos en vivo
  // sobre el formulario para avisar ANTES de guardar: activar esta combinación
  // redirige a cualquier empleado con este rol a /revendedor, sacándolo del resto
  // del dashboard.
  const activaModoRevendedor = useMemo(() => esRolRevendedor(permisosForm), [permisosForm])

  const resumenPermisos = (Object.keys(permisosForm) as (keyof Permisos)[]).reduce(
    (acc, key) => {
      if (permisosForm[key]) acc.activos += 1
      else acc.inactivos += 1
      return acc
    },
    { activos: 0, inactivos: 0 }
  )

  // Apaga una key y, en cascada, todo lo que dependa de ella (misma lógica que togglePermiso al destildar).
  function apagarConCascada(estado: Permisos, key: keyof Permisos): Permisos {
    const next = { ...estado, [key]: false }
    for (const dependency of PERMISSION_DEPENDENCIES) {
      if (dependency.requires === key) {
        next[dependency.key] = false
      }
    }
    return next
  }

  function togglePermiso(key: keyof Permisos) {
    setPermisosForm((prev) => {
      const nextValue = !prev[key]
      if (!nextValue) {
        return apagarConCascada(prev, key)
      }
      return { ...prev, [key]: nextValue }
    })
  }

  // Quick action "Ninguno": apaga todas las keys del grupo reusando la cascada de dependencias.
  function apagarGrupo(keys: (keyof Permisos)[]) {
    setPermisosForm((prev) => {
      let next = { ...prev }
      for (const key of keys) {
        next = apagarConCascada(next, key)
      }
      return next
    })
  }

  // Quick action "Todos": prende las keys del grupo cuyas dependencias estén cumplidas; las bloqueadas quedan off.
  function prenderGrupo(keys: (keyof Permisos)[]) {
    setPermisosForm((prev) => {
      const next = { ...prev }
      for (const key of keys) {
        const dependency = PERMISSION_DEPENDENCIES.find((d) => d.key === key)
        const cumpleDependencia = !dependency || next[dependency.requires]
        if (cumpleDependencia) {
          next[key] = true
        }
      }
      return next
    })
  }

  function getDependencyForPermiso(key: keyof Permisos) {
    return PERMISSION_DEPENDENCIES.find((dependency) => dependency.key === key)
  }

  function isPermisoBloqueado(key: keyof Permisos) {
    const dependency = getDependencyForPermiso(key)
    if (!dependency) return false
    return !permisosForm[dependency.requires]
  }

  function validatePermisosCliente() {
    const activeCount = (Object.keys(permisosForm) as (keyof Permisos)[]).filter((key) => permisosForm[key]).length

    if (activeCount === 0) {
      toast.error("Tenés que activar al menos 1 permiso")
      return false
    }

    for (const dependency of PERMISSION_DEPENDENCIES) {
      if (permisosForm[dependency.key] && !permisosForm[dependency.requires]) {
        toast.error(`No podés activar "${dependency.label}" sin activar "${dependency.requiresLabel}"`)
        return false
      }
    }

    return true
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()

    if (esSoloLectura) return

    if (!nombre.trim()) {
      toast.error("El nombre es obligatorio")
      return
    }

    if (!validatePermisosCliente()) {
      return
    }

    await withLoading(async () => {
      const url = modo === "crear" ? "/api/roles" : `/api/roles/${rol?.id}`
      const method = modo === "crear" ? "POST" : "PATCH"

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nombre: nombre.trim(), permisos: permisosForm }),
      })

      const data = await res.json()
      if (!res.ok) {
        toast.error(data.error ?? "Error al guardar el rol")
        return
      }

      toast.success(modo === "crear" ? "Rol creado correctamente" : "Rol actualizado correctamente")
      router.push("/dashboard/roles")
      router.refresh()
    })
  }

  return (
    <div className="space-y-8">
      <form onSubmit={handleSubmit}>
        {/* Header con título y botones */}
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            <h1 className="text-3xl font-bold tracking-[-0.02em] text-foreground">
              {modo === "crear" ? "Nuevo rol" : modo === "editar" ? `Editar — ${rol?.nombre}` : `${rol?.nombre}`}
            </h1>
            <p className="text-muted-foreground mt-1">
              {modo === "crear"
                ? "Definí el nombre y los permisos que va a tener este rol"
                : modo === "editar"
                  ? "Modificá el nombre o los permisos del rol"
                  : "Vista completa del rol usando la misma matriz de permisos que la edición."}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button type="button" variant="outline" className="h-10" asChild>
              <Link href="/dashboard/roles">Cancelar</Link>
            </Button>
            {modo === "ver" ? (
              <Button type="button" className="h-10 px-6" asChild>
                <Link href={`/dashboard/roles/${rol?.id}/editar`}>Editar rol</Link>
              </Button>
            ) : (
              <Button type="submit" className="h-10 px-6">
                {modo === "crear" ? "Crear rol" : "Guardar cambios"}
              </Button>
            )}
          </div>
        </div>

        <div className="space-y-8 mt-8">
          {/* Nombre */}
          <div className="rounded-2xl border border-border bg-card p-5 md:p-6">
            <h2 className="text-base font-semibold text-foreground mb-4">Datos del rol</h2>
            <div className="space-y-1.5 max-w-sm">
              <Label htmlFor="rol-nombre" className="text-sm text-muted-foreground">Nombre del rol</Label>
                <Input
                  id="rol-nombre"
                  className="h-10"
                  placeholder="Ej: Coordinador"
                  value={nombre}
                  onChange={(e) => setNombre(e.target.value)}
                  readOnly={esSoloLectura}
                  required
                />
            </div>
          </div>

          {/* Aviso: esta combinación activa el modo revendedor */}
          {activaModoRevendedor && (
            <div
              role="alert"
              className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4"
            >
              <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
              <div className="text-sm">
                <p className="font-semibold text-foreground">Esta combinación activa el modo revendedor</p>
                <p className="text-muted-foreground mt-1 leading-relaxed">
                  Los empleados con este rol van a ser redirigidos automáticamente al portal <code className="text-xs bg-muted px-1 py-0.5 rounded">/revendedor</code> y no van a poder usar el resto del dashboard.
                </p>
              </div>
            </div>
          )}

          {/* Permisos */}
          <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-foreground">Permisos</h2>
                <p className="text-sm text-muted-foreground mt-1">
                  Definí el mapa completo del rol. Lo importante no es solo qué puede hacer, sino también qué queda explícitamente bloqueado.
                </p>
              </div>
              <div className="flex flex-wrap gap-2 text-xs">
                <Badge variant="outline" className="gap-1.5">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                  <span className="tabular-nums text-primary">{resumenPermisos.activos}</span> activos
                </Badge>
                <Badge variant="outline" className="gap-1.5">
                  <XCircle className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="tabular-nums">{resumenPermisos.inactivos}</span> inactivos
                </Badge>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {GRUPOS.map(({ grupo, items, fullWidth }) => {
                const grupoKeys = items.map(({ key }) => key)
                const activosGrupo = items.filter(({ key }) => permisosForm[key]).length
                return (
                <div
                  key={grupo}
                  className={`rounded-2xl border border-border bg-card p-5 md:p-6 ${fullWidth ? "md:col-span-2" : ""}`}
                >
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5">
                      <h3 className="text-base font-semibold text-foreground">{grupo}</h3>
                      <Badge variant="secondary" className="tabular-nums">
                        {activosGrupo}/{items.length}
                      </Badge>
                    </div>
                    {!esSoloLectura && (
                      <div className="flex items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-2 text-xs text-muted-foreground hover:text-primary"
                          onClick={() => prenderGrupo(grupoKeys)}
                        >
                          Todos
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-10 px-2 text-xs text-muted-foreground"
                          onClick={() => apagarGrupo(grupoKeys)}
                        >
                          Ninguno
                        </Button>
                      </div>
                    )}
                  </div>
                  <div className={`grid gap-3 ${fullWidth ? "sm:grid-cols-2 lg:grid-cols-3" : "grid-cols-1"}`}>
                    {items.map(({ key, label, desc }) => (
                      (() => {
                        const dependency = getDependencyForPermiso(key)
                        const bloqueado = isPermisoBloqueado(key)

                        return (
                      <label
                        key={key}
                        className={`flex items-start justify-between gap-4 rounded-xl border px-4 py-3 transition-all duration-200 ${
                          esSoloLectura || bloqueado ? "cursor-default" : "cursor-pointer"
                        } ${
                          permisosForm[key]
                            ? "border-primary/40 bg-primary/5"
                            : bloqueado
                              ? "border-border bg-muted/20 opacity-60"
                              : "border-border bg-muted/20 hover:bg-muted/40 hover:border-primary/20 hover:shadow-sm"
                        }`}
                      >
                        <div className="flex items-start gap-3 min-w-0">
                          <input
                            type="checkbox"
                            className="h-4 w-4 mt-0.5 accent-primary shrink-0 cursor-pointer disabled:cursor-default"
                            checked={permisosForm[key]}
                            disabled={esSoloLectura || bloqueado}
                            onChange={() => togglePermiso(key)}
                          />
                          <div className="min-w-0">
                            <span className="text-sm font-medium text-foreground leading-none block">
                              {label}
                            </span>
                            {desc && (
                              <p className="text-xs text-muted-foreground mt-1 leading-relaxed">{desc}</p>
                            )}
                            {bloqueado && dependency ? (
                              <p className="text-xs text-amber-700 dark:text-amber-400 mt-2 leading-relaxed transition-opacity duration-200">
                                Activá <strong>{dependency.requiresLabel}</strong> para habilitar este permiso.
                              </p>
                            ) : null}
                          </div>
                        </div>
                        <div className="shrink-0 pt-0.5">
                          {permisosForm[key] ? (
                            <span className="inline-flex items-center gap-1 rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-primary">
                              <CheckCircle2 className="h-3 w-3" /> On
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              <XCircle className="h-3 w-3" /> Off
                            </span>
                          )}
                        </div>
                      </label>
                        )
                      })()
                    ))}
                  </div>
                </div>
                )
              })}
            </div>
          </div>

        </div>
      </form>
    </div>
  )
}
