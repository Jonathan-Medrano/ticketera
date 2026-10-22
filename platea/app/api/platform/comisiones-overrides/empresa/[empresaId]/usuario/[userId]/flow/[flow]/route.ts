import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function PUT(req: NextRequest, { params }: { params: Promise<{ empresaId: string; userId: string; flow: string }> }) {
  const { empresaId, userId, flow } = await params
  return proxyToBackend(req, `/api/platform/comisiones-overrides/empresa/${empresaId}/usuario/${userId}/flow/${flow}`)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ empresaId: string; userId: string; flow: string }> }) {
  const { empresaId, userId, flow } = await params
  return proxyToBackend(req, `/api/platform/comisiones-overrides/empresa/${empresaId}/usuario/${userId}/flow/${flow}`)
}
