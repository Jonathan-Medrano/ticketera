import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function GET(req: NextRequest) {
  const search = req.nextUrl.search
  return proxyToBackend(req, `/api/platform/audit-logs/export${search}`, { responseMode: "raw" })
}
