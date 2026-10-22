import Image from "next/image"
import type { TenantEmpresa } from "@/lib/tenant"

type TenantSuspendedProps = {
  empresa: TenantEmpresa
}

export default function TenantSuspended({ empresa }: TenantSuspendedProps) {
  const accent = empresa.color_primario || "#38bdf8"
  const bg = empresa.color_fondo || "#0b1524"
  const text = empresa.color_texto || "#ffffff"

  return (
    <div
      className="flex min-h-screen flex-col items-center justify-center px-6 py-12 text-center"
      style={{ background: bg, color: text }}
    >
      <div
        className="w-full max-w-md rounded-3xl border px-8 py-10 shadow-[0_24px_70px_rgba(0,0,0,0.18)] backdrop-blur"
        style={{ borderColor: `${accent}33`, background: `${text}0d` }}
      >
        {empresa.logo_url ? (
          <Image
            src={empresa.logo_url}
            alt={`Logo de ${empresa.nombre}`}
            width={160}
            height={64}
            unoptimized
            className="mx-auto mb-6 h-16 w-auto object-contain opacity-90"
          />
        ) : (
          <div
            className="mx-auto mb-6 flex h-16 w-16 items-center justify-center rounded-2xl text-2xl font-bold"
            style={{ background: `${accent}22`, color: accent }}
          >
            {empresa.nombre.charAt(0).toUpperCase()}
          </div>
        )}

        <h1 className="text-2xl font-bold leading-tight sm:text-3xl">
          Estamos pausados temporalmente
        </h1>

        <p className="mt-4 text-base leading-7 opacity-80">
          {empresa.nombre} no está aceptando ventas en este momento.
        </p>

        <p className="mt-3 text-sm leading-6 opacity-60">
          Si tenés una consulta sobre una compra anterior, contactanos por los canales de soporte habituales.
        </p>
      </div>

      <p className="mt-8 text-xs uppercase tracking-[0.28em] opacity-50">
        Plataforma de Ticketera
      </p>
    </div>
  )
}
