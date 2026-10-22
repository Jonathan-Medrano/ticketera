import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params
  return proxyToBackend(req, `/api/tenant/${slug}/password/forgot`, { requireAuth: false })
}
