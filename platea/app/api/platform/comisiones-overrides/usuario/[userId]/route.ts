import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function GET(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return proxyToBackend(req, `/api/platform/comisiones-overrides/usuario/${userId}`)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return proxyToBackend(req, `/api/platform/comisiones-overrides/usuario/${userId}`)
}
