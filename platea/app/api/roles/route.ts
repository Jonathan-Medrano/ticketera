import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = (req: NextRequest) =>
  proxyToBackend(req, "/api/roles")

export const POST = (req: NextRequest) =>
  proxyToBackend(req, "/api/roles")
