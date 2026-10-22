import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

// Telemetría de Victoria (fallback + votos). Fire-and-forget: el front nunca
// awaitea esta respuesta. proxyToBackend inyecta x-internal-secret + x-user y
// reenvía el 204 del backend tal cual.
export const POST = (req: NextRequest) =>
  proxyToBackend(req, "/api/victoria/feedback")
