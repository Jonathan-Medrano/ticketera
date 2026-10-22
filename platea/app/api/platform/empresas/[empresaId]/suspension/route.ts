import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ empresaId: string }> }) {
  const { empresaId } = await params
  return proxyToBackend(req, `/api/platform/empresas/${empresaId}/suspension`)
}
