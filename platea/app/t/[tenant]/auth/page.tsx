"use client"

import { useSearchParams } from "next/navigation"
import TenantNavbar from "@/components/tenant/tenant-navbar"
import TenantAuth from "@/components/tenant/tenant-auth"
import { resolveSafeTenantRedirect } from "@/lib/redirect-whitelist"
import { Suspense } from "react"

function AuthPage() {
  const searchParams = useSearchParams()
  const redirect = resolveSafeTenantRedirect(searchParams.get("redirect"))

  return (
    <>
      <TenantNavbar />
      <TenantAuth redirectTo={redirect} />
    </>
  )
}

export default function TenantAuthPage() {
  return (
    <Suspense fallback={<TenantNavbar />}>
      <AuthPage />
    </Suspense>
  )
}
