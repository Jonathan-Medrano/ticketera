import { redirect } from "next/navigation"

export default async function MisConsumiblesPage({ params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  redirect(`/t/${tenant}/mis-tickets?tab=consumibles`)
}
