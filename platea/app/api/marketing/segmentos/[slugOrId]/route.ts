import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = (req: NextRequest, { params }: { params: Promise<{ slugOrId: string }> }) =>
  params.then(({ slugOrId }) => proxyToBackend(req, `/api/marketing/segmentos/${slugOrId}`))

export const PUT = (req: NextRequest, { params }: { params: Promise<{ slugOrId: string }> }) =>
  params.then(({ slugOrId }) => proxyToBackend(req, `/api/marketing/segmentos/${slugOrId}`))

export const DELETE = (req: NextRequest, { params }: { params: Promise<{ slugOrId: string }> }) =>
  params.then(({ slugOrId }) => proxyToBackend(req, `/api/marketing/segmentos/${slugOrId}`))
