"use client"

import { useMemo } from "react"
import { useTenant } from "./tenant-provider"
import { normalizeTenantInfoPages } from "@/lib/tenant"
import type { TenantInfoPageKey } from "@/lib/tenant-info"
import { TenantInfoPageView } from "./tenant-info-page-view"

export default function TenantInfoPage({ pageKey }: { pageKey: TenantInfoPageKey }) {
  const tenant = useTenant()
  const page = useMemo(
    () => normalizeTenantInfoPages(tenant.info_pages).find((item) => item.key === pageKey && item.enabled && item.content.trim().length > 0),
    [pageKey, tenant.info_pages]
  )

  return <TenantInfoPageView tenant={tenant} title={page?.title ?? ""} content={page?.content ?? ""} available={Boolean(page)} />
}
