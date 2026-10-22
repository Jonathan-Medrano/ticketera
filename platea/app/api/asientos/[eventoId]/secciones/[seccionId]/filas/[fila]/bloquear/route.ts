import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string; seccionId: string; fila: string }> }
) => {
  const { eventoId, seccionId, fila } = await params
  return proxyToBackend(req, `/api/asientos/${eventoId}/secciones/${seccionId}/filas/${encodeURIComponent(fila)}/bloquear`)
}
