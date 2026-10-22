import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const PATCH = async (
  req: NextRequest,
  { params }: { params: Promise<{ id: string; categoriaId: string }> }
) => {
  const { id, categoriaId } = await params
  return proxyToBackend(req, `/api/eventos/${id}/categorias/${categoriaId}`)
}
