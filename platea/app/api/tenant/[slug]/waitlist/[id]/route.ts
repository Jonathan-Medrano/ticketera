import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string; id: string }> }) {
  const { slug, id } = await params
  return proxyToBackend(req, `/api/tenant/${slug}/waitlist/${id}`)
}
