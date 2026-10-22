import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const POST = async (req: NextRequest, { params }: { params: Promise<{ slug: string }> }) => {
  const { slug } = await params
  return proxyToBackend(req, `/api/tenant/${slug}/account/whatsapp/request-code`)
}
