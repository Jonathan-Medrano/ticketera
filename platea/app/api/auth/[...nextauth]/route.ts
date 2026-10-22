import { handlers } from "@/auth"
import { NextRequest } from "next/server"
import { enforceRouteRateLimit, parseCredentialIdentifier } from "@/lib/route-rate-limit"
import { isSameOriginMutationAllowed } from "@/lib/csrf-origin"
export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  return handlers.GET(req)
}

export async function POST(req: NextRequest) {
  if (!isSameOriginMutationAllowed(req)) {
    return Response.json({ error: "Origen inválido para operación sensible" }, { status: 403 })
  }

  const identifier = await parseCredentialIdentifier(req)
  const limited = await enforceRouteRateLimit(req, {
    prefix: "nextauth-credentials-login",
    windowMs: 15 * 60 * 1000,
    max: 12,
    message: "Demasiados intentos de login, esperá unos minutos antes de reintentar",
    identifier,
  })

  if (limited) {
    return limited
  }

  return handlers.POST(req)
}
