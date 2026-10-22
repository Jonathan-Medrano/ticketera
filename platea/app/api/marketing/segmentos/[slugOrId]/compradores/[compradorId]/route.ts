import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const DELETE = (
  req: NextRequest,
  { params }: { params: Promise<{ slugOrId: string; compradorId: string }> }
) =>
  params.then(({ slugOrId, compradorId }) =>
    proxyToBackend(req, `/api/marketing/segmentos/${slugOrId}/compradores/${compradorId}`)
  )
