import { auth } from "@/auth"
import EmpresasSection from "@/components/super-admin/empresas-section"
import type { PlatformCompanySummary } from "@/components/super-admin/types"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { redirect } from "next/navigation"

type PlatformCompaniesResponse = {
  data: {
    empresas: PlatformCompanySummary[]
  }
}

export default async function SuperAdminEmpresasPage() {
  const session = await auth()
  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.companies.read")) redirect(getPlatformConsoleHomePath(session.user))

  const response = await fetchBackendFromServer<PlatformCompaniesResponse>("/api/platform/empresas")

  return (
    <EmpresasSection
      initialCompanies={response.data.empresas}
      canManageSingletonOnly={hasPlatformCapability(session.user, "platform.companies.overrides.edit")}
    />
  )
}
