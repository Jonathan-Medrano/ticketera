import { redirect } from "next/navigation"
import { buildLegacyEntradasRedirect, type VentasPageSearchParams } from "@/app/(empresa)/dashboard/ventas/page-model"

export default async function EntradasPage({
  searchParams,
}: {
  searchParams: Promise<VentasPageSearchParams>
}) {
  redirect(buildLegacyEntradasRedirect(await searchParams))
}
