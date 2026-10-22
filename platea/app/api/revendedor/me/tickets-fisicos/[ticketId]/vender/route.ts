import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function POST(req: NextRequest, { params }: { params: Promise<{ ticketId: string }> }) {
  const { ticketId } = await params
  return proxyToBackend(req, `/api/revendedores/me/tickets-fisicos/${ticketId}/vender`)
}
