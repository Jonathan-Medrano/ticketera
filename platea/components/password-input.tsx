"use client"

import { useState } from "react"
import { Eye, EyeOff } from "lucide-react"

import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface PasswordInputProps {
  id?: string
  name?: string
  className?: string
  style?: React.CSSProperties
  placeholder?: string
  value: string
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void
  required?: boolean
  minLength?: number
  autoComplete?: string
  "aria-invalid"?: boolean
  "aria-describedby"?: string
}

export default function PasswordInput({
  id,
  name,
  className,
  style,
  placeholder = "••••••••",
  value,
  onChange,
  required,
  minLength,
  autoComplete,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
}: PasswordInputProps) {
  const [show, setShow] = useState(false)
  const label = show ? "Ocultar contraseña" : "Mostrar contraseña"

  return (
    <div className="relative">
      <Input
        id={id}
        name={name}
        className={cn("h-11 pr-11", className)}
        style={style}
        type={show ? "text" : "password"}
        placeholder={placeholder}
        value={value}
        onChange={onChange}
        required={required}
        minLength={minLength}
        autoComplete={autoComplete}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        aria-label={label}
        aria-pressed={show}
        className="absolute right-2 top-1/2 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  )
}
