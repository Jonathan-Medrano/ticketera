import { NextRequest, NextResponse } from "next/server"
import { proxyToBackend } from "@/lib/backend-proxy"
import { randomUUID } from "crypto"

const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001"
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET || ""

/**
 * POST /api/tenant/:slug/checkout
 *
 * Extends the simple proxy with seat reservation for numbered events.
 *
 * Flow when asiento_ids are present:
 *   1. Generate a checkout_session_id (UUID v4)
 *   2. POST to /api/asientos/reservar — reserves seats with a TTL
 *   3. If reservation returns 409 (conflict) → return error to client
 *   4. Otherwise forward to /api/tenant/:slug/checkout with checkout_session_id injected
 *
 * Free-seating events (no asiento_ids) fall straight through to proxyToBackend.
 */
export const POST = async (
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) => {
  const { slug } = await params

  // Read the body once
  let bodyText: string
  try {
    bodyText = await req.text()
  } catch {
    return NextResponse.json({ error: "No se pudo leer el cuerpo de la solicitud" }, { status: 400 })
  }

  let bodyJson: Record<string, unknown>
  try {
    bodyJson = JSON.parse(bodyText)
  } catch {
    return NextResponse.json({ error: "Cuerpo inválido — se esperaba JSON" }, { status: 400 })
  }

  const asientoIds = Array.isArray(bodyJson.asiento_ids)
    ? (bodyJson.asiento_ids as unknown[]).filter((id): id is string => typeof id === "string" && id.length > 0)
    : []

  // If this is a seated event, reserve seats before forwarding
  if (asientoIds.length > 0) {
    // The backend now requires evento_id to scope the seat lock to the right event/tenant
    // (fixes a cross-tenant seat hijack — see backend POST /api/asientos/reservar). Pull it
    // from the cart items that actually carry an asiento_id; each item's eventoId was already
    // set by checkout-content.tsx from the category the seat maps to.
    const items = Array.isArray(bodyJson.items) ? (bodyJson.items as Array<Record<string, unknown>>) : []
    const eventoIdsForSeats = new Set(
      items
        .filter((it) => typeof it.asiento_id === "string" && asientoIds.includes(it.asiento_id as string))
        .map((it) => (typeof it.eventoId === "string" ? it.eventoId : null))
        .filter((id): id is string => !!id),
    )

    if (eventoIdsForSeats.size !== 1) {
      return NextResponse.json(
        { error: "No se pudo determinar el evento de los asientos seleccionados" },
        { status: 400 },
      )
    }
    const eventoIdForSeats = [...eventoIdsForSeats][0]

    const checkoutSessionId = randomUUID()

    let reservaResponse: Response
    try {
      reservaResponse = await fetch(`${BACKEND_URL}/api/asientos/reservar`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-internal-secret": INTERNAL_SECRET,
        },
        body: JSON.stringify({
          evento_id: eventoIdForSeats,
          asiento_ids: asientoIds,
          checkout_session_id: checkoutSessionId,
          ttl_seconds: 600, // 10 minutes — matches backend checkout TTL
        }),
      })
    } catch {
      return NextResponse.json(
        { error: "No se pudo conectar al servidor de reservas" },
        { status: 502 },
      )
    }

    if (reservaResponse.status === 409) {
      // NO sugerir recargar la página: el carrito vive solo en memoria (CartProvider
      // no persiste a storage) y un reload real lo vaciaría por completo, no solo el
      // asiento en conflicto. El backend hoy no informa CUÁL asiento_id específico
      // falló (ver ASIENTOS_NO_DISPONIBLES en backend/src/routes/asientos.ts), así
      // que acá solo podemos dar una acción segura en general: volver a elegir
      // asientos sin perder el resto de la compra. checkout-content.tsx usa este
      // `code` para ofrecer navegación in-app en vez de mostrar solo texto.
      return NextResponse.json(
        {
          code: "seats_unavailable",
          error:
            "Uno o más de los asientos que elegiste ya no están disponibles. Volvé a elegir asientos — el resto de tu compra se mantiene.",
        },
        { status: 409 },
      )
    }

    if (!reservaResponse.ok) {
      let reservaError = "No se pudo reservar los asientos"
      try {
        const reservaData = await reservaResponse.json()
        if (typeof reservaData?.error === "string") reservaError = reservaData.error
      } catch { /* ignore */ }
      return NextResponse.json({ error: reservaError }, { status: reservaResponse.status })
    }

    // Inject checkout_session_id so the backend can link the reservation
    const enrichedBody = {
      ...bodyJson,
      checkout_session_id: checkoutSessionId,
    }

    // Re-create a synthetic request with the enriched body.
    // proxyToBackend reads req.text() internally, so we reconstruct the body.
    const syntheticReq = new NextRequest(req.url, {
      method: req.method,
      headers: req.headers,
      body: JSON.stringify(enrichedBody),
    })

    return proxyToBackend(syntheticReq, `/api/tenant/${slug}/checkout`, {
      requireAuth: false,
    })
  }

  // Free-seating: reconstruct request with original body and proxy as-is
  const plainReq = new NextRequest(req.url, {
    method: req.method,
    headers: req.headers,
    body: bodyText,
  })

  return proxyToBackend(plainReq, `/api/tenant/${slug}/checkout`, {
    requireAuth: false,
  })
}
