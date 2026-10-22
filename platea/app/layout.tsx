import type { Metadata } from "next"
import { Bricolage_Grotesque, Nunito } from "next/font/google"
import "./globals.css"
import NextAuthProvider from "@/components/session-provider"
import AppThemeProvider from "@/components/theme-provider"
import ClientErrorHandlers from "@/components/client-error-handlers"
import { CANARY_ATTR, CANARY_TEXT, intlFingerprint } from "@/lib/hydration-diagnostics"

const nunito = Nunito({
  variable: "--font-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
})

// Display expresivo (grotesco) para titulares editoriales de la landing.
// Reemplaza al Cormorant serif (sin uso): el lenguaje nuevo es sans + grande.
const bricolage = Bricolage_Grotesque({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700", "800"],
})

const siteUrl = process.env.NEXT_PUBLIC_APP_URL?.startsWith("http")
  ? process.env.NEXT_PUBLIC_APP_URL
  : "https://ticketera.com"

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Ticketera — Ticketera para eventos en Argentina",
    template: "%s | Ticketera",
  },
  description:
    "Ticketera todo-en-uno para eventos, boliches y productoras en Argentina. Vendé entradas, manejá la barra, check-in QR y revendedores. Tu marca, comisión 4%.",
  applicationName: "Ticketera",
  authors: [{ name: "Ticketera" }],
  generator: "Next.js",
  keywords: [
    "ticketera",
    "ticketera Argentina",
    "venta de entradas",
    "ticketing",
    "eventos Argentina",
    "boliche",
    "productoras de eventos",
    "QR check-in",
    "consumibles",
    "barra",
    "revendedores",
    "SaaS eventos",
    "Ticketera",
  ],
  category: "business",
  formatDetection: {
    telephone: false,
    email: false,
    address: false,
  },
  alternates: {
    canonical: "/",
  },
  openGraph: {
    type: "website",
    locale: "es_AR",
    url: siteUrl,
    siteName: "Ticketera",
    title: "Ticketera — Ticketera para eventos en Argentina",
    description:
      "Ticketera todo-en-uno para eventos, boliches y productoras en Argentina. Vendé entradas, manejá la barra, check-in QR y revendedores. Tu marca, comisión 4%.",
    images: [{ url: "/opengraph-image", width: 1200, height: 630, alt: "Ticketera — Ticketera para eventos en Argentina" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Ticketera — Ticketera para eventos en Argentina",
    description:
      "Ticketera todo-en-uno para eventos, boliches y productoras en Argentina. Vendé entradas con tu marca. Comisión 4%.",
    images: [{ url: "/opengraph-image" }],
  },
  icons: {
    // Contenedor azul (no la marca exenta): el favicon tiene que leerse igual
    // sobre el chrome claro y el oscuro del navegador.
    // El SVG va primero para los navegadores que lo soportan; los PNG son el
    // fallback real (Safari viejo, algunos crawlers, la pestana en Windows).
    icon: [
      { url: '/ticketera_logo_app.svg', type: 'image/svg+xml' },
      { url: '/ticketera_logo_icono_32.png', sizes: '32x32', type: 'image/png' },
      { url: '/ticketera_logo_icono_16.png', sizes: '16x16', type: 'image/png' },
    ],
    // iOS NO soporta SVG en apple-touch-icon: con un SVG aca, "Agregar a inicio"
    // en un iPhone queda sin icono. Tiene que ser PNG si o si.
    apple: [{ url: '/ticketera_logo_app_180.png', sizes: '180x180', type: 'image/png' }],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
}

const jsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": "https://ticketera.com/#organization",
      name: "Ticketera",
      url: "https://ticketera.com",
      logo: { "@type": "ImageObject", url: "https://ticketera.com/ticketera_logo_app.svg" },
    },
    {
      "@type": "SoftwareApplication",
      "@id": "https://ticketera.com/#app",
      name: "Ticketera",
      applicationCategory: "BusinessApplication",
      operatingSystem: "Web",
      description:
        "Ticketera todo-en-uno para eventos, boliches y productoras en Argentina. Venta de entradas, consumibles, check-in QR, revendedores. Comisión 4%.",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "ARS",
        description: "Sin costo fijo. Comisión del 4% por ticket vendido.",
      },
      url: "https://ticketera.com",
    },
    {
      "@type": "WebSite",
      "@id": "https://ticketera.com/#website",
      url: "https://ticketera.com",
      name: "Ticketera",
      publisher: { "@id": "https://ticketera.com/#organization" },
    },
  ],
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="es-AR"
      className={`${nunito.variable} ${bricolage.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[9999] focus:rounded-lg focus:bg-background focus:px-4 focus:py-2 focus:text-foreground focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-ring"
        >
          Saltar al contenido principal
        </a>
        {/* Canario de integridad del DOM (diagnóstico temporal de hydration
            mismatches). Texto fijo en español escrito por el servidor: si un
            traductor automático o un in-app browser reescribe la página antes
            de que React hidrate, este texto cambia y el reporte de error lo
            delata. `suppressHydrationWarning` para que el canario no se
            convierta él mismo en un error nuevo cuando lo toquen. */}
        <span {...{ [CANARY_ATTR]: "" }} className="sr-only" aria-hidden="true" suppressHydrationWarning>
          {CANARY_TEXT}
        </span>
        <ClientErrorHandlers serverIntl={intlFingerprint()} />
        <AppThemeProvider>
          <NextAuthProvider>{children}</NextAuthProvider>
        </AppThemeProvider>
      </body>
    </html>
  )
}
