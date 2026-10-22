import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function GET(req: NextRequest) {
  return proxyToBackend(req, "/api/configuracion")
}

export async function PATCH(req: NextRequest) {
  return proxyToBackend(req, "/api/configuracion")
}
