import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = (req: NextRequest) =>
  proxyToBackend(req, "/api/eventos/liquidacion/export", { responseMode: "raw" })
