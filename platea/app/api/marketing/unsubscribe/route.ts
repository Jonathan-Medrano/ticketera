import { NextRequest, NextResponse } from 'next/server'

const BACKEND_URL = process.env.BACKEND_URL ?? 'http://localhost:3001'
const INTERNAL_SECRET = process.env.INTERNAL_API_SECRET ?? ''

// GET: el link del email cae acá, pero SOLO renderiza la página de confirmación —
// no ejecuta la baja. Un GET sin interacción del usuario es seguido automáticamente
// por escáneres corporativos de correo (Microsoft Safe Links, Proofpoint), que si
// este handler diera de baja directamente estarían optando por el usuario sin que
// nadie haya hecho clic. La baja real la dispara el POST de abajo, desde el botón
// de la página de confirmación (/unsubscribe?token=...).
export const GET = async (req: NextRequest) => {
  const token = req.nextUrl.searchParams.get('token')
  if (!token) return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url))
  return NextResponse.redirect(new URL(`/unsubscribe?token=${encodeURIComponent(token)}`, req.url))
}

// POST: ejecuta la baja real. Se llama desde el <form method="POST"> de la página
// de confirmación al click explícito del usuario. Redirige con 303 (POST→GET) para
// que el navegador no reintente el POST si el usuario recarga la página de resultado.
export const POST = async (req: NextRequest) => {
  const form = await req.formData()
  const token = form.get('token')
  if (!token || typeof token !== 'string') {
    return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url), 303)
  }

  try {
    const res = await fetch(`${BACKEND_URL}/api/marketing/unsubscribe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-secret': INTERNAL_SECRET,
      },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url), 303)
    }
  } catch {
    return NextResponse.redirect(new URL('/unsubscribe?error=1', req.url), 303)
  }

  return NextResponse.redirect(new URL('/unsubscribe?ok=1', req.url), 303)
}
