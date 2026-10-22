import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = async (req: NextRequest, { params }: { params: Promise<{ eventoId: string }> }) => {
  const { eventoId } = await params
  return proxyToBackend(req, `/api/asientos/${eventoId}/secciones`)
}

export const POST = async (req: NextRequest, { params }: { params: Promise<{ eventoId: string }> }) => {
  const { eventoId } = await params
  return proxyToBackend(req, `/api/asientos/${eventoId}/secciones`)
}
