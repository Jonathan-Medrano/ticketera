import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { Mail, Receipt } from "lucide-react"
import type { Permisos } from "@/lib/permisos"
import { fetchBackendFromServer } from "@/lib/server-backend"
import PosSection from "@/components/dashboard/pos-section"
import { Button } from "@/components/ui/button"

type PosEventosResponse = {
  data: {
    habilitado: boolean
    eventos: Array<{
      id: string
      nombre: string
      modo_fecha: string
      imagen_url: string | null
      categorias: Array<{ id: string; nombre: string; precio: number; stock_disponible: number; imagen_url: string | null }>
      fechas: Array<{ id: string; fecha: string }>
    }>
  }
}

export default async function PosPage() {
  const session = await auth()
  if (!session) redirect("/login")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"
  // Para vender en POS: cualquier rol con ver_eventos. Si querés más estricto, agregar nuevo permiso.
  if (esEmpleado && !permisos?.ver_eventos) redirect("/sin-acceso")

  const eventos = await fetchBackendFromServer<PosEventosResponse>(`/api/dashboard/pos/eventos`)

  if (!eventos.data.habilitado) {
    return (
      <div className="space-y-4 p-6">
        <header className="space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">Punto de venta</h1>
          <p className="text-sm text-muted-foreground">Cobrá entradas en mano y emití el QR al instante.</p>
        </header>
        <div className="flex flex-col items-center rounded-2xl border border-border bg-card px-6 py-12 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Receipt className="h-5 w-5" aria-hidden />
          </div>
          <h2 className="mt-4 text-base font-semibold text-foreground">Todavía no activaste la venta en el momento</h2>
          <p className="mt-2 max-w-md text-sm leading-6 text-muted-foreground">
            Esta función requiere activación expresa de Ticketera, para evitar que se configuren cobros físicos por
            accidente. Escribinos y la activamos para tu empresa.
          </p>
          <Button asChild className="mt-5 gap-2">
            <a href="mailto:soporte@ticketera.com?subject=Activar%20punto%20de%20venta%20(POS)">
              <Mail className="h-4 w-4" aria-hidden />
              Pedir activación a soporte
            </a>
          </Button>
        </div>
      </div>
    )
  }

  return <PosSection eventos={eventos.data.eventos} />
}
