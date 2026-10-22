import Link from "next/link"

export default function TenantNotFound() {
  return (
    <div
      className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-4 text-center"
      style={{ background: "var(--tenant-fondo)", color: "var(--tenant-texto)" }}
    >
      <div className="flex flex-col items-center gap-2">
        <p className="text-sm font-medium" style={{ opacity: 0.5 }}>
          404
        </p>
        <h1 className="text-xl font-semibold">Página no encontrada</h1>
        <p className="max-w-xs text-sm" style={{ opacity: 0.6 }}>
          Esta página no existe o fue eliminada.
        </p>
      </div>
      <Link
        href="."
        className="rounded-lg px-5 py-2.5 text-sm font-medium transition-opacity hover:opacity-80"
        style={{ background: "var(--tenant-primary)", color: "#fff" }}
      >
        Volver al inicio
      </Link>
    </div>
  )
}
