"use client"

import * as React from "react"
import Link from "next/link"
import type { VariantProps } from "class-variance-authority"

import { Button, buttonVariants } from "@/components/ui/button"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"

type ButtonLikeProps = Omit<
  React.ComponentProps<typeof Button>,
  "aria-label" | "asChild" | "children"
>

type LinkLikeProps = Omit<
  React.ComponentProps<typeof Link>,
  "aria-label" | "children" | "href"
>

/**
 * Abstracción para acciones icon-only.
 * Requiere `label`, aplica `aria-label` y usa tooltip desktop por defecto.
 * No usar cuando ya exista texto visible ni como reemplazo de `title` solamente.
 */
type IconActionProps = {
  label: string
  tooltip?: React.ReactNode
  disabled?: boolean
  disabledReason?: React.ReactNode
  children: React.ReactNode
  href?: string
  asChild?: boolean
} & Pick<ButtonLikeProps, "className" | "onClick" | "type" | "style">
  & VariantProps<typeof buttonVariants>
  & LinkLikeProps

function IconAction({
  label,
  tooltip,
  disabled = false,
  disabledReason,
  children,
  href,
  asChild = false,
  className,
  onClick,
  type = "button",
  variant = "ghost",
  size = "icon-sm",
  style,
  ...linkProps
}: IconActionProps) {
  const tooltipContent = disabled && disabledReason ? disabledReason : (tooltip ?? label)
  const tooltipDisabled = !tooltipContent

  let control: React.ReactNode

  if (href) {
    // `disabled` no existe como atributo nativo en <a>, así que si está deshabilitado
    // renderizamos un <button> real (sin asChild/Link) para bloquear la navegación.
    // Si no, envolvemos el Link y le pasamos `onClick` — el caller puede interceptar
    // la navegación llamando a `event.preventDefault()` ahí adentro.
    control = disabled ? (
      <Button variant={variant} size={size} className={className} style={style} disabled aria-label={label}>
        {children}
      </Button>
    ) : (
      <Button variant={variant} size={size} className={className} style={style} asChild>
        <Link href={href} aria-label={label} onClick={onClick} {...linkProps}>
          {children}
        </Link>
      </Button>
    )
  } else if (asChild) {
    control = (
      <Button variant={variant} size={size} className={className} style={style} asChild>
        {React.isValidElement(children)
          ? React.cloneElement(children, {
              "aria-label": label,
            } as Record<string, unknown>)
          : children}
      </Button>
    )
  } else {
    control = (
      <Button
        type={type}
        variant={variant}
        size={size}
        className={className}
        style={style}
        onClick={onClick}
        aria-label={label}
        disabled={disabled}
      >
        {children}
      </Button>
    )
  }

  if (disabled && disabledReason) {
    control = (
      <span
        className="inline-flex"
        tabIndex={0}
        role="button"
        aria-label={label}
        aria-disabled="true"
      >
        {control}
      </span>
    )
  }

  return (
    <TooltipProvider>
      <Tooltip disabled={tooltipDisabled}>
        <TooltipTrigger asChild>{control}</TooltipTrigger>
        <TooltipContent>{tooltipContent}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export { IconAction }
