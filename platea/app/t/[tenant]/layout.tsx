import type { Metadata } from "next"
import { headers } from "next/headers"
import { fetchPublicBackendFromServer } from "@/lib/server-backend"
import type { TenantEmpresa } from "@/lib/tenant"
import TenantSurfaceShell from "@/components/tenant/tenant-surface-shell"
import { enforceBuyerPasswordRotation } from "@/lib/buyer-session/server"

export async function generateMetadata({ params }: { params: Promise<{ tenant: string }> }): Promise<Metadata> {
  const { tenant } = await params
  try {
    const response = await fetchPublicBackendFromServer<{ data: { empresa: TenantEmpresa } }>(`/api/tenant/${tenant}`, { revalidate: 300, tags: [`tenant:${tenant}`] })
    const empresa = response.data.empresa
    // favicon_url: optimizado para pestaña (cuadrado chico). Fallback a logo_url.
    const iconUrl = empresa?.favicon_url || empresa?.logo_url
    const title = empresa?.nombre || undefined
    const description = empresa?.descripcion || undefined
    const ogImage = empresa?.logo_url || undefined
    return {
      title,
      description,
      openGraph: { title, description, ...(ogImage ? { images: [ogImage] } : {}) },
      ...(iconUrl ? { icons: { icon: iconUrl } } : {}),
    }
  } catch {
    // fallback al favicon global
  }
  return {}
}

export default async function TenantLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ tenant: string }>
}) {
  const { tenant } = await params

  // Bloquear acceso a cualquier ruta del tenant si el comprador tiene
  // must_change_password=true. Skip en /actualizar-password (sino loop) y en
  // /auth/* (el login es la PUERTA — si tenés must_change pero no estás logueado,
  // pasás por login antes de poder rotar).
  const headersList = await headers()
  const tenantPath = headersList.get("x-tenant-path") ?? ""
  const isRotationPath = tenantPath === "/actualizar-password" || tenantPath.startsWith("/actualizar-password/")
  const isAuthPath = tenantPath.startsWith("/auth")
  if (!isRotationPath && !isAuthPath) {
    await enforceBuyerPasswordRotation(tenant)
  }

  return <TenantSurfaceShell tenant={tenant}>{children}</TenantSurfaceShell>
}
