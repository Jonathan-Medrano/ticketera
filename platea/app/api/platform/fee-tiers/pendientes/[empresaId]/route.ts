import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params
  return proxyToBackend(req, `/api/platform/fee-tiers/pendientes/${empresaId}`)
}
