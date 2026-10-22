import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

/**
 * GET /api/asientos/:eventoId/disponibilidad
 *
 * Public proxy — no buyer auth required. Forwards to the backend public
 * availability endpoint which returns per-section seat state for numbered
 * events. The x-internal-secret is added by proxyToBackend automatically.
 */
export const GET = async (
  req: NextRequest,
  { params }: { params: Promise<{ eventoId: string }> },
) => {
  const { eventoId } = await params
  return proxyToBackend(req, `/api/asientos/${eventoId}/disponibilidad`, {
    requireAuth: false,
  })
}
