import { auth } from "@/auth"
import { redirect } from "next/navigation"
import RevendedorTicketsFisicosContent from "@/components/revendedor/tickets-fisicos-content"
import { isRevendedor, type Permisos } from "@/lib/permisos"

export default async function RevendedorTicketsFisicosPage() {
  const session = await auth()
  if (!session) redirect("/login")

  // Mismo criterio que app/revendedor/layout.tsx: empleadoRol (DB) con fallback
  // a la heurística de permisos para sessions viejas. Antes este guard solo
  // chequeaba empleadoRol, así que un revendedor detectado por heurística pasaba
  // el layout pero era expulsado acá.
  const permisos = session.user.permisos as Permisos | undefined
  if (!isRevendedor({ empleadoRol: session.user.empleadoRol, permisos })) redirect("/sin-acceso")

  return <RevendedorTicketsFisicosContent />
}
