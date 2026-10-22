import { redirect } from "next/navigation"

export default async function MisConsumiblesEntryPage() {
  redirect("/mis-tickets?tab=consumibles")
}
