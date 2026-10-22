import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; consumibleId: string }> },
) => {
  const { id, consumibleId } = await params
  return proxyToBackend(req, `/api/consumibles/barras/${id}/items/${consumibleId}`)
}
