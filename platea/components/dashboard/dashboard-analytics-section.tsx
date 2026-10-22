"use client"

import { useRouter } from "next/navigation"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts"

function EmptyAnalyticsState({ message }: { message: string }) {
  return (
    <div className="flex h-[280px] items-center justify-center rounded-card-sm border border-dashed border-border bg-background/55 px-6 text-center text-sm text-muted-foreground">
      {message}
    </div>
  )
}

export default function DashboardAnalyticsSection({
  ventasPorDia,
  ventasPorEvento,
  tooltipStyle,
}: {
  ventasPorDia: { dia: string; ventas: number }[]
  ventasPorEvento: { evento_id: string; evento: string; ventas: number }[]
  tooltipStyle: Record<string, string>
}) {
  const router = useRouter()

  function handleBarClick(data: unknown) {
    // Recharts onClick signature varía: el data point full puede venir como
    // `data.payload` o directamente como `data`. Probamos ambos.
    const rec = data as { payload?: { evento_id?: string }; evento_id?: string } | null
    const eventoId = rec?.payload?.evento_id ?? rec?.evento_id
    if (eventoId && typeof eventoId === "string") {
      router.push(`/dashboard/eventos/${eventoId}`)
    }
  }

  return (
    <div className="rounded-panel border border-border bg-card p-4 shadow-sm md:p-6">
      <div className="flex flex-col gap-2 border-b border-border pb-4 md:flex-row md:items-end md:justify-between">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-muted-foreground">Analítica</p>
          <h2 className="mt-2 text-lg font-semibold text-foreground">Cómo se está moviendo la venta</h2>
        </div>
        <p className="text-xs text-muted-foreground">Leé tendencia diaria o performance por evento.</p>
      </div>

      <Tabs defaultValue="dias" className="mt-5">
        <TabsList className="mb-5 h-12! w-full max-w-md grid grid-cols-2 rounded-2xl border border-border bg-muted/60 p-1">
          <TabsTrigger value="dias" className="flex-1 rounded-xl px-6 text-sm font-semibold text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_8px_24px_rgba(2,6,23,0.12)]">Ventas por día</TabsTrigger>
          <TabsTrigger value="eventos" className="flex-1 rounded-xl px-6 text-sm font-semibold text-muted-foreground transition-all hover:cursor-pointer hover:text-foreground data-active:bg-card data-active:text-foreground data-active:shadow-[0_8px_24px_rgba(2,6,23,0.12)]">Ventas por evento</TabsTrigger>
        </TabsList>

        <TabsContent value="dias" className="mt-0">
          {ventasPorDia.length === 0 ? (
            <EmptyAnalyticsState message="No hay ventas en los últimos 30 días." />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={ventasPorDia}>
                <defs>
                  <linearGradient id="colorVentas" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0052cc" stopOpacity={0.22} />
                    <stop offset="95%" stopColor="#0052cc" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="dia" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                <Tooltip contentStyle={tooltipStyle} />
                <Area type="monotone" dataKey="ventas" stroke="#0052cc" strokeWidth={2.5} fill="url(#colorVentas)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </TabsContent>

        <TabsContent value="eventos" className="mt-0">
          {ventasPorEvento.length === 0 ? (
            <EmptyAnalyticsState message="Todavía no hay eventos con ventas para comparar." />
          ) : (
            <>
              <p className="mb-2 text-[11px] text-muted-foreground">
                Click en una barra para ir al detalle del evento →
              </p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={ventasPorEvento} barSize={42}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="evento" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} axisLine={false} tickLine={false} />
                  <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
                  <Bar
                    dataKey="ventas"
                    fill="#0052cc"
                    radius={[10, 10, 0, 0]}
                    cursor="pointer"
                    onClick={handleBarClick}
                  />
                </BarChart>
              </ResponsiveContainer>
            </>
          )}
        </TabsContent>
      </Tabs>
    </div>
  )
}
