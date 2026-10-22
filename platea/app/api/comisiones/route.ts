import { NextRequest } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"

// Proxea al endpoint de comisiones reales del backend. Auth por defecto
// (dashboard de empresa). proxyToBackend reenvía los query params (desde/hasta).
export const GET = (req: NextRequest) => proxyToBackend(req, "/api/comisiones")
