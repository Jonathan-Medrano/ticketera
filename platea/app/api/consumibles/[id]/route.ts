import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const PUT = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/consumibles/${id}`)
}

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/consumibles/${id}`)
}
