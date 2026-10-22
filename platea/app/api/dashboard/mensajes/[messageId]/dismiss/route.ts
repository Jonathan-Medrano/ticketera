import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function POST(req: NextRequest, { params }: { params: Promise<{ messageId: string }> }) {
  const { messageId } = await params
  return proxyToBackend(req, `/api/dashboard/mensajes/${messageId}/dismiss`)
}
