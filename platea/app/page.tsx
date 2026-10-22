import Homepage from "./(marketing)/homepage"
import { redirect } from "next/navigation"
import { resolveTenantFromHost } from "@/lib/tenant-host"

export const dynamic = "force-dynamic"

export default async function RootPage() {
  const tenant = await resolveTenantFromHost()

  if (tenant) {
    redirect(`/t/${tenant}`)
  }

  return <Homepage />
}
