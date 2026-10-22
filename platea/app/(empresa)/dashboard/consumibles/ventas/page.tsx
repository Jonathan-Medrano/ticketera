import { redirect } from "next/navigation"
import { buildLegacyConsumiblesRedirect, type VentasPageSearchParams } from "@/app/(empresa)/dashboard/ventas/page-model"

export default async function ConsumiblesVentasPage({
  searchParams,
}: {
  searchParams: Promise<VentasPageSearchParams>
}) {
  redirect(buildLegacyConsumiblesRedirect(await searchParams))
}
