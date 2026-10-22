import { auth } from "@/auth"
import { redirect } from "next/navigation"
import { fetchBackendFromServer } from "@/lib/server-backend"
import DemoDataSection from "@/components/dashboard/demo-data-section"

type FeaturesResponse = { data: { posMovilHabilitado?: boolean } }

export default async function DemoDataPage() {
  const session = await auth()
  if (!session) redirect("/login")

  // Guard cliente: pedimos al backend si la empresa es de prueba
  type StatusResponse = { data: { habilitado: boolean; empresa_nombre: string | null } }
  let status: StatusResponse | null = null
  try {
    status = await fetchBackendFromServer<StatusResponse>(`/api/dashboard/demo-data/status`)
  } catch {
    status = null
  }

  if (!status?.data.habilitado) {
    return (
      <div className="space-y-4 p-6">
        <h1 className="text-2xl font-semibold text-foreground">Datos demo</h1>
        <div className="rounded-xl border border-border/60 bg-muted/50 p-6">
          <p className="text-sm text-foreground/80">
            <strong>Esta funcionalidad está reservada para cuentas de prueba.</strong> Tu empresa no está marcada como{" "}
            <code className="font-mono">es_prueba=true</code>. Si necesitás convertirla en prueba, pedile al super-admin que actualice
            el flag.
          </p>
        </div>
      </div>
    )
  }

  return <DemoDataSection empresaNombre={status.data.empresa_nombre ?? ""} />
}

// Avoid stale data — re-fetch on every render for demo controls
export const dynamic = "force-dynamic"
void {} as unknown as FeaturesResponse
