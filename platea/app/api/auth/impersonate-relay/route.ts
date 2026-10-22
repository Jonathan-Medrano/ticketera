import { cookies } from "next/headers"
import { NextRequest, NextResponse } from "next/server"

const COOKIE_NAME = "platea_impersonate_relay"

export async function POST(req: NextRequest) {
  let body: { token?: unknown }
  try {
    body = await req.json() as { token?: unknown }
  } catch {
    return NextResponse.json({ error: "Body inválido" }, { status: 400 })
  }
  const token = body?.token

  if (!token || typeof token !== "string" || token.trim() === "") {
    return NextResponse.json({ error: "Token inválido" }, { status: 400 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 30,
    path: "/",
  })
  return res
}

export async function GET() {
  const cookieStore = await cookies()
  const cookie = cookieStore.get(COOKIE_NAME)

  if (!cookie?.value) {
    return NextResponse.json(
      { error: "Token no disponible o ya utilizado" },
      { status: 404 }
    )
  }

  const token = cookie.value

  const res = NextResponse.json({ token })
  res.cookies.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    maxAge: 0,
    path: "/",
  })
  return res
}
