import { proxyToBackend } from "@/lib/backend-proxy"
import type { NextRequest } from "next/server"

export async function PATCH(req: NextRequest) {
  return proxyToBackend(req, "/api/platform/me/password")
}
