import { NextRequest, NextResponse } from "next/server"

import { proxyToBackend } from "@/lib/backend-proxy"

const actionToPath: Record<string, (id: string) => string> = {
  link_items: (id) => `/api/reembolsos/${id}/items`,
  approve: (id) => `/api/reembolsos/${id}/approve`,
  reject: (id) => `/api/reembolsos/${id}/reject`,
  execute: (id) => `/api/reembolsos/${id}/execute`,
  resolve_non_refundable: (id) => `/api/reembolsos/${id}/resolve-non-refundable`,
}

export const GET = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/reembolsos/${id}`)
}

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params

  try {
    const payload = await req.clone().json() as { action?: string }
    const action = typeof payload?.action === "string" ? payload.action : ""
    const path = actionToPath[action]

    if (!path) {
      return NextResponse.json({ error: "Acción de reembolso no soportada" }, { status: 400 })
    }

    return proxyToBackend(req, path(id))
  } catch {
    return NextResponse.json({ error: "Body inválido para acción de reembolso" }, { status: 400 })
  }
}
