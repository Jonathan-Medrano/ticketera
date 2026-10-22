import { NextResponse } from "next/server"

export const GET = async () => {
  return NextResponse.json(
    { error: "Este endpoint ya no está disponible. Usá el flujo de acceso actual." },
    { status: 410 }
  )
}
