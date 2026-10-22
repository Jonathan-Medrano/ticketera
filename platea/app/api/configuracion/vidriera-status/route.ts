import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function PATCH(req: NextRequest) {
  return proxyToBackend(req, "/api/configuracion/vidriera-status")
}
