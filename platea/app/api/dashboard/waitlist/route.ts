import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export async function GET(req: NextRequest) {
  const search = req.nextUrl.search ?? ""
  return proxyToBackend(req, `/api/dashboard/waitlist${search}`)
}
