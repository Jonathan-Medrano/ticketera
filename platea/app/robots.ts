import type { MetadataRoute } from "next"

const siteUrl = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://ticketera.com"

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/dashboard/",
          "/super-admin/",
          "/revendedor/",
          "/login",
          "/auth/",
          "/checkout/",
          "/sin-acceso",
        ],
      },
    ],
    sitemap: `${siteUrl}/sitemap.xml`,
  }
}
