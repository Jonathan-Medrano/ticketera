import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ loteId: string }> }) {
  const { loteId } = await params
  return proxyToBackend(req, `/api/preimpresos/${loteId}/estado`)
}
