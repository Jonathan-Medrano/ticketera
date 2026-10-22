import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) => {
  const { sessionId } = await params
  return proxyToBackend(req, `/api/reconciliacion/${encodeURIComponent(sessionId)}/reembolsar`)
}
