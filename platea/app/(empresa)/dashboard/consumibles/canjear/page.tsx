import { redirect } from "next/navigation"

export default async function ConsumiblesCanjearPage() {
  redirect("/dashboard/escanear?modo=consumibles")
}
