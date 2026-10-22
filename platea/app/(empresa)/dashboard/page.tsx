import DashboardContent from "@/components/dashboard/dashboard-content"
import { requireDashboardHomeSession } from "@/lib/dashboard-auth"
import { puedeHacer } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import type { SalesReadinessReason, SalesReadinessStatus } from "@/lib/tenant"

type FeaturesResponse = { data: { consumiblesHabilitado?: boolean; posMovilHabilitado?: boolean } }

type CobrosReadinessResponse = {
  data: {
    sales_readiness: {
      status: SalesReadinessStatus
      reason: SalesReadinessReason | null
      canSell: boolean
    }
    sitio_configurado?: boolean
  }
}

type DashboardResumenResponse = {
  data: {
    metricas: {
      ventas: number
      ingresos_netos: number
      ingresos_brutos_empresa: number
      ingresos_brutos_totales: number
      compradores: number
      eventosActivos: number
    }
    comparacion: {
      ventas: number
      ingresos_netos: number | null
      ingresos_brutos_totales: number | null
      compradores: number
      desde: string
      hasta: string
    } | null
    ventas_por_dia: Array<{ dia: string; ventas: number }>
    ventas_por_evento: Array<{ evento_id: string; evento: string; ventas: number }>
    top_categorias: Array<{
      categoria_id: string | null
      categoria: string
      evento_id: string | null
      evento_nombre: string | null
      ventas: number
      bruto: number | null
    }>
    heatmap_horario: Array<{ dia_semana: number; hora: number; ventas: number }>
    ultimas_ventas: Array<{
      id: string
      precio_pagado: number
      created_at: string
      estado: string
      comprador_nombre: string
      comprador_email: string
      evento_nombre: string
      categoria_nombre: string | null
    }>
    proximo_evento: {
      id: string
      nombre: string
      fecha: string
      vendidas: number
      compradores: number
      recaudado: number | null
      capacidad: number
      kind: "actual" | "proximo" | "activo"
    } | null
    eventos: Array<{
      id: string
      nombre: string
    }>
    eventos_activos: Array<{
      id: string
      nombre: string
      fecha: string
      vendidas: number
      compradores: number
      recaudado: number | null
      capacidad: number
      kind: "actual" | "proximo" | "activo"
    }>
    periodo: {
      desde: string | null
      hasta: string | null
    }
    filtros: {
      evento: string | null
    }
  }
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ desde?: string; hasta?: string; evento?: string }>
}) {
  const { session, permisos, esEmpleado } = await requireDashboardHomeSession()

  const params = await searchParams
  const qs = new URLSearchParams()
  if (params.desde) qs.set("desde", params.desde)
  if (params.hasta) qs.set("hasta", params.hasta)
  if (params.evento) qs.set("evento", params.evento)

  const puedeVerRecaudacion = puedeHacer("ver_recaudacion", esEmpleado, permisos)

  const [resumen, reconciliacionResumen, featuresResult, cobrosResult] = await Promise.all([
    fetchBackendFromServer<DashboardResumenResponse>(
      `/api/dashboard/resumen${qs.toString() ? `?${qs.toString()}` : ""}`,
    ),
    puedeVerRecaudacion
      ? fetchBackendFromServer<{ data: { totalPendientes: number } }>(`/api/reconciliacion/resumen`, { revalidate: 300 }).catch(() => null)
      : Promise.resolve(null),
    fetchBackendFromServer<FeaturesResponse>(`/api/dashboard/features`).catch(() => null),
    // Only fetch for company owners — employees don't see the onboarding card
    !esEmpleado
      ? fetchBackendFromServer<CobrosReadinessResponse>(`/api/cobros/mercadopago`, { revalidate: 60 }).catch(() => null)
      : Promise.resolve(null),
  ])

  const reconciliacionPendientes = reconciliacionResumen?.data.totalPendientes ?? 0
  const featureFlags = {
    consumiblesHabilitado: featuresResult?.data.consumiblesHabilitado ?? true,
    posMovilHabilitado: featuresResult?.data.posMovilHabilitado ?? false,
  }

  // Ocultar ingresos si no tiene permiso
  const mostrarIngresos = puedeHacer("ver_ingresos", esEmpleado, permisos)
  const proximoEvento = resumen.data.proximo_evento
    ? {
        ...resumen.data.proximo_evento,
        recaudado: mostrarIngresos ? Number(resumen.data.proximo_evento.recaudado ?? 0) : null,
      }
    : null

  const salesReadiness = cobrosResult?.data.sales_readiness ?? null
  const sitioConfigurado = cobrosResult?.data.sitio_configurado ?? false

  return (
    <DashboardContent
      session={session}
      salesReadiness={salesReadiness}
      sitioConfigurado={sitioConfigurado}
      metricas={{
        ventas: resumen.data.metricas.ventas,
        ingresosNetos: mostrarIngresos ? Number(resumen.data.metricas.ingresos_netos ?? 0) : null,
        ingresosBrutosEmpresa: mostrarIngresos ? Number(resumen.data.metricas.ingresos_brutos_empresa ?? 0) : null,
        ingresosBrutosTotales: mostrarIngresos ? Number(resumen.data.metricas.ingresos_brutos_totales ?? 0) : null,
        compradores: resumen.data.metricas.compradores,
        eventosActivos: resumen.data.metricas.eventosActivos,
      }}
      ventasPorDia={resumen.data.ventas_por_dia.map((v) => ({
        dia: new Date(v.dia).toLocaleDateString("es-AR", { day: "numeric", month: "short", timeZone: "America/Argentina/Buenos_Aires" }),
        ventas: v.ventas,
      }))}
      ventasPorEvento={resumen.data.ventas_por_evento.map((v) => ({
        evento_id: v.evento_id,
        evento: v.evento,
        ventas: v.ventas,
      }))}
      topCategorias={resumen.data.top_categorias ?? []}
      heatmapHorario={resumen.data.heatmap_horario ?? []}
      comparacion={
        resumen.data.comparacion
          ? {
              ventas: resumen.data.comparacion.ventas,
              ingresosNetos: mostrarIngresos ? Number(resumen.data.comparacion.ingresos_netos ?? 0) : null,
              ingresosBrutosTotales: mostrarIngresos
                ? Number(resumen.data.comparacion.ingresos_brutos_totales ?? 0)
                : null,
              compradores: resumen.data.comparacion.compradores,
              desde: resumen.data.comparacion.desde,
              hasta: resumen.data.comparacion.hasta,
            }
          : null
      }
      ultimasVentas={resumen.data.ultimas_ventas}
      proximoEvento={proximoEvento}
      eventosActivos={resumen.data.eventos_activos.map((evento) => ({
        ...evento,
        recaudado: mostrarIngresos ? Number(evento.recaudado ?? 0) : null,
      }))}
      eventos={resumen.data.eventos}
      filtroEvento={resumen.data.filtros.evento}
      periodo={resumen.data.periodo}
      reconciliacionPendientes={reconciliacionPendientes}
      permisos={permisos}
      esEmpleado={esEmpleado}
      featureFlags={featureFlags}
    />
  )
}
