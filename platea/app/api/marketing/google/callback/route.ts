import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

// El backend responde con un 302. proxyToBackend con redirect:"manual"
// intercepta el 302 y hace NextResponse.redirect al Location header.
export const GET = (req: NextRequest) =>
  proxyToBackend(req, "/api/marketing/google/callback")
