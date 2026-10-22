import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = async (req: NextRequest) => {
  const url = new URL(req.url)
  const search = url.search ? url.search : ""
  return proxyToBackend(req, `/api/dashboard/addons${search}`)
}

export const POST = async (req: NextRequest) => {
  return proxyToBackend(req, `/api/dashboard/addons`)
}
