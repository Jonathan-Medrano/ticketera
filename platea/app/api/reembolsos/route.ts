import { NextRequest } from "next/server"

import { proxyToBackend } from "@/lib/backend-proxy"

export const GET = (req: NextRequest) => proxyToBackend(req, "/api/reembolsos")

export const POST = (req: NextRequest) => proxyToBackend(req, "/api/reembolsos")

export const PATCH = (req: NextRequest) => proxyToBackend(req, "/api/reembolsos")
