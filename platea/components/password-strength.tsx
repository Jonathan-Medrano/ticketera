"use client"

import { Check } from "lucide-react"

import { getPasswordPolicyChecks, type PasswordPolicyCheck } from "@/lib/password-policy"
import { cn } from "@/lib/utils"

type Props = {
  password: string
  className?: string
  id?: string
}

type StrengthLevel = 0 | 1 | 2 | 3 | 4

type Strength = {
  level: StrengthLevel
  label: string
  segmentClass: string
  textClass: string
}

const shortLabels: Record<PasswordPolicyCheck["key"], string> = {
  minLength: "12 caracteres",
  uppercase: "mayúscula",
  lowercase: "minúscula",
  number: "número",
  special: "carácter especial",
  noWhitespace: "sin espacios",
}

function computeStrength(password: string, okCount: number): Strength {
  if (password.length === 0) {
    return {
      level: 0,
      label: "",
      segmentClass: "",
      textClass: "",
    }
  }

  let level: StrengthLevel
  if (okCount <= 2) level = 1
  else if (okCount <= 4) level = 2
  else if (okCount === 5) level = 3
  else level = 4

  if (password.length < 8 && level > 1) level = 1
  else if (password.length < 12 && level > 2) level = 2

  switch (level) {
    case 1:
      return {
        level,
        label: "Mala",
        segmentClass: "bg-red-500",
        textClass: "text-red-600 dark:text-red-400",
      }
    case 2:
      return {
        level,
        label: "Aceptable",
        segmentClass: "bg-amber-500",
        textClass: "text-amber-600 dark:text-amber-400",
      }
    case 3:
      return {
        level,
        label: "Sólida",
        segmentClass: "bg-[color:var(--marketing-accent)]",
        textClass: "text-[color:var(--marketing-accent)]",
      }
    case 4:
      return {
        level,
        label: "Fuerte",
        segmentClass: "bg-emerald-500",
        textClass: "text-emerald-600 dark:text-emerald-400",
      }
    default:
      return {
        level: 0,
        label: "",
        segmentClass: "",
        textClass: "",
      }
  }
}

export default function PasswordStrength({ password, className, id }: Props) {
  const checks = getPasswordPolicyChecks(password)
  const okCount = checks.filter((c) => c.ok).length
  const strength = computeStrength(password, okCount)
  const missing = checks.filter((c) => !c.ok)
  const allOk = missing.length === 0 && password.length > 0

  return (
    <div id={id} aria-live="polite" className={cn("mt-2 space-y-2", className)}>
      <div className="flex items-center gap-3">
        <div className="flex flex-1 gap-1">
          {[1, 2, 3, 4].map((seg) => {
            const active = strength.level >= seg
            return (
              <span
                key={seg}
                aria-hidden="true"
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors duration-300",
                  // Inactivo: usa foreground/25 para que se adapte al tema actual
                  // (dashboard light/dark, marketing, tenant). Antes usaba
                  // var(--marketing-border) que es 8% navy hardcoded → invisible
                  // en backgrounds claros.
                  active ? strength.segmentClass : "bg-foreground/25"
                )}
              />
            )
          })}
        </div>
        {strength.label ? (
          <span
            className={cn(
              "text-[10px] font-semibold uppercase tracking-[0.22em] transition-colors duration-200",
              strength.textClass
            )}
          >
            {strength.label}
          </span>
        ) : null}
      </div>

      {allOk ? (
        <p className="flex items-center gap-1.5 text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
          <Check className="h-3.5 w-3.5" strokeWidth={3} />
          Contraseña segura
        </p>
      ) : password.length > 0 ? (
        <p className="text-[11px] leading-5 text-foreground/70">
          Te falta:{" "}
          <span className="font-semibold text-foreground">
            {missing.map((c) => shortLabels[c.key]).join(" · ")}
          </span>
        </p>
      ) : (
        <p className="text-[11px] leading-5 text-foreground/70">
          12 caracteres con mayúscula, minúscula, número y carácter especial.
        </p>
      )}
    </div>
  )
}
