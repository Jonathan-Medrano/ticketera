import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const POST = (req: NextRequest) =>
  proxyToBackend(req, "/api/marketing/google/gtm-selection")
