import TenantTokenLogin from "@/components/tenant/tenant-token-login"
import TenantNavbar from "@/components/tenant/tenant-navbar"

export default async function TokenPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>
}) {
  const { token } = await searchParams
  return (
    <>
      <TenantNavbar />
      <TenantTokenLogin token={token} />
    </>
  )
}
