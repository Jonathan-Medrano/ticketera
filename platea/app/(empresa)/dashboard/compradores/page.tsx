// app/(empresa)/dashboard/compradores/page.tsx
import { auth } from "@/auth"
import { redirect } from "next/navigation"
import CompradoresContent from "@/components/dashboard/compradores-content"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"

type CompradoresResponse = {
  data: {
    compradores: Array<{
      id: string
      nombre: string
      apellido?: string | null
      email?: string | null
      dni?: string | null
      created_at: string
      total_entradas: number
      total_gastado: number
      ultima_compra?: string | null
      eventos_ids?: string | null
    }>
    eventos: Array<{
      id: string
      nombre: string
    }>
    totals: {
      total_compradores: number
      total_entradas: number
      total_gastado: number
      total_con_email: number
    }
  }
  pagination: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

type CompradoresSummaryResponse = {
  data: {
    global: {
      total_compradores: number
      con_email: number
      con_email_pct: number
      sin_compras: number
      con_1_compra: number
      con_2_o_mas: number
      tasa_recurrencia_pct: number
      ticket_promedio_neto: number | null
      total_vip: number
      vip_pct: number
    }
    top_spender: {
      id: string
      nombre: string
      email: string | null
      total_gastado: number
      total_entradas: number
    } | null
    nuevos_30d: number
  }
}

export default async function CompradoresPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string; pageSize?: string; busqueda?: string; evento?: string; desde?: string; hasta?: string; sortBy?: string; sortDir?: string }>
}) {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"

  if (esEmpleado && !permisos?.ver_compradores) redirect("/sin-acceso")
  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.page) qs.set("page", params.page)
  if (params.pageSize) qs.set("pageSize", params.pageSize)
  if (params.busqueda) qs.set("busqueda", params.busqueda)
  if (params.evento) qs.set("evento", params.evento)
  if (params.desde) qs.set("desde", params.desde)
  if (params.hasta) qs.set("hasta", params.hasta)
  if (params.sortBy) qs.set("sortBy", params.sortBy)
  if (params.sortDir) qs.set("sortDir", params.sortDir)

  const puedeVerRecaudacion = puedeHacer("ver_recaudacion", esEmpleado, permisos)

  const [response, summary] = await Promise.all([
    fetchBackendFromServer<CompradoresResponse>(
      `/api/compradores${qs.toString() ? `?${qs.toString()}` : ""}`
    ),
    puedeVerRecaudacion
      ? fetchBackendFromServer<CompradoresSummaryResponse>(`/api/compradores/summary`).catch(() => null)
      : Promise.resolve(null),
  ])

  return (
    <CompradoresContent
      compradores={response.data.compradores}
      eventos={response.data.eventos}
      totals={response.data.totals}
      pagination={response.pagination}
      exportPath={`/api/compradores/export${qs.toString() ? `?${qs.toString()}` : ""}`}
      permisos={permisos}
      esEmpleado={esEmpleado}
      summary={summary?.data ?? null}
    />
  )
}
