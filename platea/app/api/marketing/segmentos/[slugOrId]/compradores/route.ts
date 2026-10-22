import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = (req: NextRequest, { params }: { params: Promise<{ slugOrId: string }> }) =>
  params.then(({ slugOrId }) => proxyToBackend(req, `/api/marketing/segmentos/${slugOrId}/compradores`))

export const POST = (req: NextRequest, { params }: { params: Promise<{ slugOrId: string }> }) =>
  params.then(({ slugOrId }) => proxyToBackend(req, `/api/marketing/segmentos/${slugOrId}/compradores`))
