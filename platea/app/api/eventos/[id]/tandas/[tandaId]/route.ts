import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; tandaId: string }> }
) => {
  const { id, tandaId } = await params
  return proxyToBackend(req, `/api/eventos/${id}/tandas/${tandaId}`)
}
