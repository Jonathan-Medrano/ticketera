import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const PATCH = (req: NextRequest) =>
  proxyToBackend(req, "/api/equipo/comision-default")
