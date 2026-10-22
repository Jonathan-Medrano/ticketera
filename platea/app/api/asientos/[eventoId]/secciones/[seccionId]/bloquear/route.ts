import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; seccionId: string }> }
) => {
  const { eventoId, seccionId } = await params
  return proxyToBackend(req, `/api/asientos/${eventoId}/secciones/${seccionId}/bloquear`)
}
