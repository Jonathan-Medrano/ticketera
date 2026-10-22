import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return proxyToBackend(req, `/api/platform/usuarios/${userId}`)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ userId: string }> }) {
  const { userId } = await params
  return proxyToBackend(req, `/api/platform/usuarios/${userId}`)
}
