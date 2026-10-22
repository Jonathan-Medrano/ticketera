import { auth } from "@/auth"
import { redirect, notFound } from "next/navigation"
import { fetchBackendFromServer } from "@/lib/server-backend"
import type { Permisos } from "@/lib/permisos"
import PreimpresosSection from "@/components/dashboard/preimpresos-section"

type EventoDetalleResponse = {
  evento: {
    id: string
    nombre: string
    modo_fecha: "unica" | "multiple" | "pase"
  } | null
  categorias: Array<{ id: string; nombre: string; precio: number; activa: number }>
  fechas: Array<{ id: string; fecha: string }>
}

type RevendedoresResponse = {
  data?: { revendedores?: Array<{ id: string; nombre: string; apellido: string | null; activo: boolean }> }
  revendedores?: Array<{ id: string; nombre: string; apellido: string | null; activo: boolean }>
}

export default async function PreimpresosPage({ params }: { params: Promise<{ id: string }> }) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"
  if (esEmpleado && !permisos?.ver_eventos) redirect("/sin-acceso")

  const { id } = await params
  const detalle = await fetchBackendFromServer<EventoDetalleResponse>(`/api/eventos/${id}`)
  if (!detalle.evento) notFound()

  // Best-effort fetch of revendedores. If the endpoint shape doesn't match or
  // the user lacks permission, we just pass an empty array — the assignment UI
  // will hide itself in that case.
  let revendedores: Array<{ id: string; nombre: string }> = []
  try {
    const r = await fetchBackendFromServer<RevendedoresResponse>(`/api/revendedores?pageSize=200`)
    const list = r.data?.revendedores ?? r.revendedores ?? []
    revendedores = list
      .filter((rev) => rev.activo)
      .map((rev) => ({ id: rev.id, nombre: `${rev.nombre} ${rev.apellido ?? ""}`.trim() }))
  } catch {
    revendedores = []
  }

  return (
    <PreimpresosSection
      eventoId={id}
      eventoNombre={detalle.evento.nombre}
      modoFecha={detalle.evento.modo_fecha}
      categorias={detalle.categorias.filter((c) => Boolean(c.activa))}
      fechas={detalle.fechas}
      revendedores={revendedores}
    />
  )
}
