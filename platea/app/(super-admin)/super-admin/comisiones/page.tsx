import { auth } from "@/auth"
import { redirect } from "next/navigation"
import ComisionesOverridesSection from "@/components/super-admin/comisiones-overrides-section"
import type { PlatformCompanySummary } from "@/components/super-admin/types"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"

type PlatformCompaniesResponse = { data: { empresas: PlatformCompanySummary[] } }
type PlatformUsuariosResponse = {
  data: {
    usuarios: Array<{
      id: string
      nombre: string
      roleSlug: string
      isSingletonSuperadmin?: boolean
      activo?: boolean
      revenueGrants?: { entradas?: number; consumibles?: number }
      shareByFlow?: { entradas?: number; consumibles?: number }
    }>
  }
}

export default async function SuperAdminComisionesPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.companies.read")) {
    redirect(getPlatformConsoleHomePath(session.user))
  }

  const canEdit = hasPlatformCapability(session.user, "platform.companies.overrides.edit")

  const [empresasRes, usuariosRes] = await Promise.all([
    fetchBackendFromServer<PlatformCompaniesResponse>("/api/platform/empresas"),
    fetchBackendFromServer<PlatformUsuariosResponse>("/api/platform/usuarios"),
  ])

  const empresas = empresasRes.data.empresas.map((empresa) => ({
    id: empresa.id,
    nombre: empresa.nombre,
    slug: empresa.slug,
  }))

  const teamMembers = usuariosRes.data.usuarios
    .filter((user) => !user.isSingletonSuperadmin && user.activo !== false)
    .map((user) => ({
      id: user.id,
      nombre: user.nombre,
      roleSlug: user.roleSlug,
      globalShareEntradas: Number(user.revenueGrants?.entradas ?? user.shareByFlow?.entradas ?? 0),
      globalShareConsumibles: Number(user.revenueGrants?.consumibles ?? user.shareByFlow?.consumibles ?? 0),
    }))

  return (
    <ComisionesOverridesSection
      empresas={empresas}
      teamMembers={teamMembers}
      canEdit={canEdit}
    />
  )
}
