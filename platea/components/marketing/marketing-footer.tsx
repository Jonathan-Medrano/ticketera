import Image from "next/image"
import Link from "next/link"

type MarketingFooterProps = {
  className?: string
}

const linkClass =
  "rounded-md px-1 py-1 text-sm text-[color:var(--marketing-muted)] transition-colors duration-200 ease-out hover:text-[color:var(--marketing-ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-end)]"

const productoLinks = [
  { href: "/#funcionalidades", label: "Cómo funciona" },
  { href: "/#control", label: "Control y cierre" },
  { href: "/login?tab=registro", label: "Crear mi espacio" },
]

const soporteLinks = [
  { href: "/soporte", label: "Centro de soporte" },
  { href: "/contacto", label: "Contacto" },
]

const legalLinks = [
  { href: "/terminos", label: "Términos" },
  { href: "/privacidad", label: "Privacidad" },
]

export default function MarketingFooter({ className }: MarketingFooterProps) {
  const year = new Date().getFullYear()

  return (
    <footer className={className ?? "border-t border-[color:var(--marketing-border)] px-6 py-12 lg:px-10"}>
      <div className="mx-auto w-full max-w-[1600px]">
        <div className="grid gap-10 sm:grid-cols-3 md:grid-cols-5 md:gap-8 lg:gap-12">
          <div className="sm:col-span-3 md:col-span-2">
            <Link
              href="/"
              aria-label="Ticketera"
              className="inline-flex items-center gap-2.5 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--marketing-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--marketing-bg-end)]"
            >
              <Image src="/ticketera_logo_app.svg" alt="" width={38} height={38} className="shrink-0" />
              <span className="marketing-brand-wordmark text-[1.85rem]">Ticket<span>era</span></span>
            </Link>
            <p className="marketing-card-body mt-4 max-w-xs text-[color:var(--marketing-muted)]">
              Para productores que prefieren vender tickets a pelear con planillas.
            </p>
          </div>

          <div>
            <p className="marketing-kicker">Producto</p>
            <nav aria-label="Navegación de producto" className="mt-4 flex flex-col items-start gap-2">
              {productoLinks.map(({ href, label }) => (
                <Link key={href} href={href} className={linkClass}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div>
            <p className="marketing-kicker">Soporte</p>
            <nav aria-label="Navegación de soporte" className="mt-4 flex flex-col items-start gap-2">
              {soporteLinks.map(({ href, label }) => (
                <Link key={href} href={href} className={linkClass}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>

          <div>
            <p className="marketing-kicker">Legal</p>
            <nav aria-label="Navegación legal" className="mt-4 flex flex-col items-start gap-2">
              {legalLinks.map(({ href, label }) => (
                <Link key={href} href={href} className={linkClass}>
                  {label}
                </Link>
              ))}
            </nav>
          </div>
        </div>

        <div className="mt-12 flex flex-col gap-2 border-t border-[color:var(--marketing-border)] pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-[color:var(--marketing-muted)]">
            &copy; {year} Ticketera · Hecho en Argentina, por gente que también vendió tickets bajo lluvia.
          </p>
        </div>
      </div>
    </footer>
  )
}
