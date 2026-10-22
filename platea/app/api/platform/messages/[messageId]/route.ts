import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params
  return proxyToBackend(req, `/api/platform/mensajes/${messageId}`)
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params
  return proxyToBackend(req, `/api/platform/mensajes/${messageId}`)
}
