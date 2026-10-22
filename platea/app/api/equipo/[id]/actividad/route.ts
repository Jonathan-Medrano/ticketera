import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  const url = new URL(req.url)
  const query = url.searchParams.toString()
  return proxyToBackend(req, `/api/equipo/${id}/actividad${query ? `?${query}` : ""}`)
}
