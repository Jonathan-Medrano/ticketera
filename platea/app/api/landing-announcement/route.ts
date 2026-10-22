import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

// Público — sin auth. Lee el anuncio activo de la landing pública.
export async function GET(req: NextRequest) {
  return proxyToBackend(req, "/api/landing-announcement", { requireAuth: false })
}
