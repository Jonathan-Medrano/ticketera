"use client"

import type { InputHTMLAttributes, TextareaHTMLAttributes } from "react"
import type { TenantEmpresa } from "@/lib/tenant"

type TenantInputProps = InputHTMLAttributes<HTMLInputElement> & {
  tenant: TenantEmpresa
  error?: boolean
}

type TenantTextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  tenant: TenantEmpresa
  error?: boolean
}

// El `padding` shorthand inline pisa el `py-3` de la clase y deja el input sin
// altura: colapsa a la del texto. Paso en produccion (login/registro/reset del
// tenant, reportado 01-ago-2026): 11 call sites pasaban `padding: "0 16px"` y
// los campos quedaban de ~22px de alto en mobile.
//
// Se descarta el shorthand y se conserva el resto del style. Para ajustar solo
// el eje horizontal (ej. dejar lugar al ojito de la password) usar las
// longhand `paddingLeft` / `paddingRight`, que si se respetan.
function sinPaddingShorthand(style?: React.CSSProperties): React.CSSProperties {
  if (!style || style.padding === undefined) return style ?? {}
  const resto = { ...style }
  delete resto.padding
  if (process.env.NODE_ENV !== "production") {
    console.warn(
      "[TenantInput] Se ignoro el `padding` shorthand: rompe la altura del campo. " +
      "Usa paddingLeft/paddingRight si necesitas ajustar el eje horizontal.",
    )
  }
  return resto
}

export function TenantInput({ tenant, error, className = "", style, ...props }: TenantInputProps) {
  return (
    <input
      {...props}
      // La clase `tenant-field` engancha la regla `:-webkit-autofill` con !important
      // en globals.css (la regla global no gana sobre estos inputs con estilos inline).
      className={`tenant-field w-full py-3 px-4 border rounded-xl text-sm focus:outline-none focus:ring-2 ${className}`.trim()}
      style={{
        background: `${tenant.color_texto}10`,
        borderColor: `${tenant.color_texto}20`,
        color: tenant.color_texto,
        "--tw-ring-color": `${tenant.color_primario}50`,
        ...sinPaddingShorthand(style),
        ...(error ? { borderColor: "hsl(var(--destructive))", "--tw-ring-color": "hsl(var(--destructive) / 0.35)" } : {}),
      } as React.CSSProperties}
    />
  )
}

export function TenantTextarea({ tenant, error, className = "", style, ...props }: TenantTextareaProps) {
  return (
    <textarea
      {...props}
      className={`tenant-field w-full border rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 resize-none ${className}`.trim()}
      style={{
        background: `${tenant.color_texto}10`,
        borderColor: `${tenant.color_texto}20`,
        color: tenant.color_texto,
        "--tw-ring-color": `${tenant.color_primario}50`,
        ...sinPaddingShorthand(style),
        ...(error ? { borderColor: "hsl(var(--destructive))", "--tw-ring-color": "hsl(var(--destructive) / 0.35)" } : {}),
      } as React.CSSProperties}
    />
  )
}
