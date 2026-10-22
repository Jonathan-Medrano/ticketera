import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = (req: NextRequest) =>
  proxyToBackend(req, "/api/marketing/analitica/tracking")

export const PUT = (req: NextRequest) =>
  proxyToBackend(req, "/api/marketing/analitica/tracking")
