import { auth } from "@/auth"
import UsuariosSection from "@/components/super-admin/usuarios-section"
import type { PlatformRole, PlatformUser, PlatformBranchTreeNode, PlatformCapabilityCatalogEntry, PlatformViewerPolicy } from "@/components/super-admin/types"
import { getPlatformConsoleHomePath, hasPlatformCapability, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { fetchBackendFromServer } from "@/lib/server-backend"
import { redirect } from "next/navigation"

type PlatformUsersResponse = {
  data: {
    usuarios: PlatformUser[]
    viewerPolicy: PlatformViewerPolicy
    capabilityCatalog: PlatformCapabilityCatalogEntry[]
    branchTree: PlatformBranchTreeNode[]
  }
}

type PlatformRolesResponse = {
  data: {
    roles: PlatformRole[]
  }
}

export default async function SuperAdminUsuariosPage() {
  const session = await auth()

  if (!session) redirect("/login")
  if (!isPlatformConsoleActor(session.user)) redirect("/dashboard")
  if (!hasPlatformCapability(session.user, "platform.users.read")) redirect(getPlatformConsoleHomePath(session.user))

  const usersResponse = await fetchBackendFromServer<PlatformUsersResponse>("/api/platform/usuarios")
  const rolesResponse = await fetchBackendFromServer<PlatformRolesResponse>("/api/platform/roles")

  return (
    <UsuariosSection
      initialUsers={usersResponse.data.usuarios}
      initialRoles={rolesResponse.data.roles}
      initialViewerPolicy={usersResponse.data.viewerPolicy}
      initialCapabilityCatalog={usersResponse.data.capabilityCatalog}
      initialBranchTree={usersResponse.data.branchTree}
      canManageSingletonOnly={hasPlatformCapability(session.user, "platform.users.write")}
      canGrantCapabilities={hasPlatformCapability(session.user, "platform.users.capabilities.grant")}
    />
  )
}
