import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

function resolveBackendPath(action: string) {
  if (action === "start") return "/api/cobros/mercadopago/oauth/start"
  if (action === "callback") return "/api/cobros/mercadopago/oauth/callback"
  return null
}

export async function POST(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params
  const backendPath = resolveBackendPath(action)
  if (!backendPath || action !== "start") {
    return new Response("Not Found", { status: 404 })
  }

  return proxyToBackend(req, backendPath)
}

export async function GET(req: NextRequest, context: { params: Promise<{ action: string }> }) {
  const { action } = await context.params
  const backendPath = resolveBackendPath(action)
  if (!backendPath || action !== "callback") {
    return new Response("Not Found", { status: 404 })
  }

  return proxyToBackend(req, backendPath)
}
