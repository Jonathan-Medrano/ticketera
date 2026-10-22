import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/consumibles/barras/${id}/stock`)
}

export const POST = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/consumibles/barras/${id}/stock`)
}

export const PUT = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/consumibles/barras/${id}/stock`)
}
