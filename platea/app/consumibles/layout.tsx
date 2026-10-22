import { notFound } from "next/navigation"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export default async function ConsumiblesEntryLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const tenant = await resolveTenantFromHost()

  if (!tenant) notFound()

  return <TenantSurfaceShell tenant={tenant}>{children}</TenantSurfaceShell>
}
