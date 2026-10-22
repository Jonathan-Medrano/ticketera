import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const PUT = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  params.then(({ id }) => proxyToBackend(req, `/api/marketing/promociones/${id}`))

export const DELETE = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  params.then(({ id }) => proxyToBackend(req, `/api/marketing/promociones/${id}`))
