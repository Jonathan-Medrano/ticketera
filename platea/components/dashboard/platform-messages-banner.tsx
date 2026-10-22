"use client"

import { useState } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"

type MessageTipo = "info" | "warning" | "critical"

type PlatformMessage = {
  id: string
  titulo: string
  cuerpo: string
  tipo: MessageTipo
}

const DISMISSED_STORAGE_KEY = "dismissed_platform_msgs"

function loadDismissed(): Set<string> {
  try {
    const raw = sessionStorage.getItem(DISMISSED_STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as string[]
      return new Set(parsed)
    }
  } catch {
    // sessionStorage not available
  }
  return new Set()
}

function saveDismissed(set: Set<string>) {
  try {
    sessionStorage.setItem(DISMISSED_STORAGE_KEY, JSON.stringify([...set]))
  } catch {
    // ignore
  }
}

function bgClass(tipo: MessageTipo) {
  if (tipo === "critical") return "border-red-400/40 bg-red-500/12 text-red-700 dark:text-red-200"
  if (tipo === "warning") return "border-amber-400/40 bg-amber-500/12 text-amber-700 dark:text-amber-200"
  return "border-blue-400/40 bg-blue-500/12 text-[color:var(--marketing-accent)] dark:text-blue-200"
}

export default function PlatformMessagesBanner({ messages }: { messages: PlatformMessage[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(loadDismissed)

  function dismiss(id: string) {
    const next = new Set(dismissed)
    next.add(id)
    setDismissed(next)
    saveDismissed(next)
    void fetch(`/api/dashboard/mensajes/${id}/dismiss`, { method: "POST" }).catch(() => undefined)
  }

  const visible = messages.filter((m) => !dismissed.has(m.id))
  if (visible.length === 0) return null

  return (
    <div className="space-y-2 px-4 pt-4 md:px-6 lg:px-8">
      {visible.map((msg) => (
        <div
          key={msg.id}
          className={cn("flex items-start justify-between gap-4 rounded-xl border px-4 py-3 text-sm", bgClass(msg.tipo))}
        >
          <div className="min-w-0 flex-1">
            <span className="font-semibold">{msg.titulo}</span>
            {msg.cuerpo ? <span className="ml-1.5 opacity-85">{msg.cuerpo}</span> : null}
          </div>
          <button
            type="button"
            onClick={() => dismiss(msg.id)}
            className="shrink-0 rounded-md p-0.5 opacity-70 hover:opacity-100"
            aria-label="Cerrar"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ))}
    </div>
  )
}
