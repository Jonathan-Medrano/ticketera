import { auth } from "@/auth"
import { getPlatformConsoleHomePath } from "@/lib/internal-actor-routing"
import { redirect } from "next/navigation"

export default async function SuperAdminPage() {
  const session = await auth()
  redirect(getPlatformConsoleHomePath(session?.user ?? {}))
}
