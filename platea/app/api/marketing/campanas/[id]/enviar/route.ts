import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const POST = (req: NextRequest, { params }: { params: Promise<{ id: string }> }) =>
  params.then(({ id }) => proxyToBackend(req, `/api/marketing/campanas/${id}/enviar`))
