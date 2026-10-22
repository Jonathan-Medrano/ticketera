"use client"

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts"
import { formatBucketShort, money } from "@/components/super-admin/utils"

export type EmpresaDetailChartPoint = {
  dia: string
  total: number
}

export default function EmpresaDetailChart({ data }: { data: EmpresaDetailChartPoint[] }) {
  const periodDays = data.length || 30

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id="companyGain" x1="0" x2="0" y1="0" y2="1">
            <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.7} />
            <stop offset="95%" stopColor="var(--primary)" stopOpacity={0.06} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--superadmin-chart-grid)" vertical={false} />
        <XAxis
          dataKey="dia"
          stroke="var(--muted-foreground)"
          tickLine={false}
          axisLine={false}
          tickFormatter={(value) => formatBucketShort(String(value ?? ""), periodDays)}
          minTickGap={32}
        />
        <YAxis stroke="var(--muted-foreground)" tickLine={false} axisLine={false} tickFormatter={(value) => money(Number(value ?? 0))} width={100} />
        <Tooltip
          contentStyle={{
            background: "var(--popover)",
            border: "1px solid var(--border)",
            borderRadius: 18,
            color: "var(--popover-foreground)",
          }}
          formatter={(value) => money(Number(value ?? 0))}
          labelFormatter={(label) => formatBucketShort(String(label ?? ""), periodDays)}
        />
        <Area type="monotone" dataKey="total" stroke="var(--primary)" fill="url(#companyGain)" strokeWidth={2.5} />
      </AreaChart>
    </ResponsiveContainer>
  )
}
