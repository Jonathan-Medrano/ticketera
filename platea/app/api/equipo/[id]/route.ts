import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/equipo/${id}`)
}

export const PATCH = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/equipo/${id}`)
}

export const DELETE = async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params
  return proxyToBackend(req, `/api/equipo/${id}`)
}
