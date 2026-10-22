import { auth } from "@/auth"
import { redirect } from "next/navigation"

import FeeTiersSection, {
  type FeeTier,
  type FeeTierPendiente,
} from "@/components/super-admin/fee-tiers-section"
import { fetchBackendFromServer } from "@/lib/server-backend"
import {
  getPlatformConsoleHomePath,
  hasPlatformCapability,
  isPlatformConsoleActor,
} from "@/lib/internal-actor-routing"

type TiersResponse = { data: { tiers: FeeTier[] } }
type PendientesResponse = { data: { pendientes: FeeTierPendiente[] } }

export default async function SuperAdminFeeTiersPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.settings.read")) {
    redirect(getPlatformConsoleHomePath(session.user))
  }

  const canEditEscalera = hasPlatformCapability(session.user, "platform.fees.defaults.edit")
  const canEditEmpresa = hasPlatformCapability(session.user, "platform.companies.overrides.edit")

  const [tiersRes, pendientesRes] = await Promise.all([
    fetchBackendFromServer<TiersResponse>("/api/platform/fee-tiers"),
    fetchBackendFromServer<PendientesResponse>("/api/platform/fee-tiers/pendientes"),
  ])

  return (
    <div className="space-y-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold">Comisiones por volumen</h1>
        <p className="text-sm text-muted-foreground">
          La comisión baja sola cuando una empresa vende más. Subirla siempre requiere tu aprobación.
        </p>
      </header>

      <FeeTiersSection
        tiersIniciales={tiersRes.data.tiers}
        pendientesIniciales={pendientesRes.data.pendientes}
        canEditEscalera={canEditEscalera}
        canEditEmpresa={canEditEmpresa}
      />
    </div>
  )
}
