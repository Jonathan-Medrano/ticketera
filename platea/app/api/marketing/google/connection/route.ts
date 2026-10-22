import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const DELETE = (req: NextRequest) =>
  proxyToBackend(req, "/api/marketing/google/connection")
