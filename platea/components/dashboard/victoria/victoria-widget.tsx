"use client"

// Victoria — asistente de ayuda flotante del dashboard de empresa.
//
// 100% client-side: el contenido sale de lib/victoria/knowledge.ts y el matching
// de lib/victoria/match.ts (rule-based por keywords). NO hace fetch, no llama a
// ninguna API ni LLM. El "escribiendo…" es puro feel, no hay request detrás.

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ArrowRight, ArrowUp, MessageCircle, RotateCcw, Sparkles, ThumbsDown, ThumbsUp, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { isTopicEnabled, matchTopic, relatedTopics, topSuggestions, topicGateReasonFor, type GateReason, type VictoriaAccess } from "@/lib/victoria/match"
import type { FeatureFlags, Topic } from "@/lib/victoria/knowledge"
import type { Permisos } from "@/lib/permisos"
import { topicForPath } from "@/lib/victoria/route-topic"
import { logVictoriaFeedback } from "@/lib/victoria/telemetry"

type Message =
  | { id: number; role: "user"; text: string }
  | { id: number; role: "victoria"; kind: "intro" }
  | { id: number; role: "victoria"; kind: "intro-contextual"; topic: Topic }
  | { id: number; role: "victoria"; kind: "topic"; topic: Topic; voted?: "up" | "down" }
  | { id: number; role: "victoria"; kind: "gated"; topic: Topic; reason: GateReason }
  | { id: number; role: "victoria"; kind: "fallback" }

/** Respuesta pendiente que `respond` materializa tras el delay de typing. */
type PendingAnswer =
  | { kind: "topic"; topic: Topic }
  | { kind: "gated"; topic: Topic; reason: GateReason }
  | { kind: "fallback" }

const TYPING_MS = 650

// Rutas con barra de guardado sticky en el borde inferior. En ellas, Victoria
// (FAB + panel) se levanta para no taparla. OJO: si estas rutas cambian de
// layout o se agregan otras con barra sticky inferior, actualizá este array.
const STICKY_SAVE_ROUTES = ["/dashboard/sitio-venta", "/dashboard/configuracion"]

// Pulse de bienvenida del FAB: solo la primera vez que se monta en la sesión.
// Vive en memoria del módulo (no persiste, no toca KB ni storage).
let pulseShownThisSession = false

const chipClass =
  "rounded-full border border-border bg-card px-2.5 py-1 text-[12px] font-medium text-foreground/80 " +
  "transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"

let messageSeq = 0
const nextId = () => ++messageSeq

function VictoriaAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground",
        className,
      )}
    >
      V
    </span>
  )
}

function TypingDots() {
  return (
    <span className="flex items-center gap-1 py-0.5" aria-label="Victoria está escribiendo">
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="size-1.5 animate-bounce rounded-full bg-muted-foreground/60 motion-reduce:animate-none"
          style={{ animationDelay: `${i * 120}ms`, animationDuration: "1s" }}
        />
      ))}
    </span>
  )
}

/** Fila de chips de temas (sugerencias generales o relacionados). */
function TopicChips({ topics, onAskTopic }: { topics: Topic[]; onAskTopic: (t: Topic) => void }) {
  if (topics.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1.5">
      {topics.map((t) => (
        <button key={t.id} type="button" className={chipClass} onClick={() => onAskTopic(t)}>
          {t.titulo}
        </button>
      ))}
    </div>
  )
}

const voteButtonClass =
  "flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors " +
  "hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 " +
  "disabled:pointer-events-none"

function TopicAnswer({
  topic,
  access,
  voted,
  onAskTopic,
  onNavigate,
  onVote,
}: {
  topic: Topic
  access: VictoriaAccess
  voted?: "up" | "down"
  onAskTopic: (t: Topic) => void
  onNavigate: () => void
  onVote: (voto: "up" | "down") => void
}) {
  const related = relatedTopics(topic, access)
  return (
    <div className="space-y-2.5">
      <p className="text-[13px] leading-relaxed text-foreground/90">{topic.intro}</p>

      {topic.pasos && topic.pasos.length > 0 ? (
        <ol className="space-y-1.5">
          {topic.pasos.map((paso, i) => (
            <li key={i} className="flex gap-2.5">
              <span className="mt-px flex size-5 shrink-0 items-center justify-center rounded-md bg-primary/10 text-[11px] font-semibold tabular-nums text-primary">
                {i + 1}
              </span>
              <span className="text-[13px] leading-relaxed text-foreground/90">{paso}</span>
            </li>
          ))}
        </ol>
      ) : null}

      {topic.cta ? (
        <Button asChild size="sm" className="mt-0.5 h-auto w-full whitespace-normal py-2 text-center leading-snug">
          <Link href={topic.cta.href} onClick={onNavigate}>
            {topic.cta.label}
            <ArrowRight data-icon="inline-end" />
          </Link>
        </Button>
      ) : null}

      {related.length > 0 ? (
        <div className="space-y-1.5 pt-0.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">Te puede servir</p>
          <TopicChips topics={related} onAskTopic={onAskTopic} />
        </div>
      ) : null}

      {/* Voto discreto: un voto por mensaje, irreversible. Telemetría fire-and-forget. */}
      <div className="border-t border-border/60 pt-2">
        {voted ? (
          <p className="text-[11px] text-muted-foreground">¡Gracias! 🙌</p>
        ) : (
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-muted-foreground">¿Te sirvió?</span>
            <button
              type="button"
              onClick={() => onVote("up")}
              aria-label="Sí, me sirvió"
              className={voteButtonClass}
            >
              <ThumbsUp className="size-4" />
            </button>
            <button
              type="button"
              onClick={() => onVote("down")}
              aria-label="No me sirvió"
              className={voteButtonClass}
            >
              <ThumbsDown className="size-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

export default function VictoriaWidget({
  featureFlags,
  permisos,
  userType,
}: {
  featureFlags?: FeatureFlags
  permisos?: Permisos
  userType?: string
}) {
  const [open, setOpen] = useState(false)
  const [messages, setMessages] = useState<Message[]>([])
  const [input, setInput] = useState("")
  const [isTyping, setIsTyping] = useState(false)
  const [showPulse, setShowPulse] = useState(false)
  const pathname = usePathname()

  // ¿La ruta actual tiene barra de guardado sticky abajo? Si sí, levantamos el FAB
  // y el ancla del panel para no taparla. Presentacional puro (no afecta temas).
  const hasStickyBar = STICKY_SAVE_ROUTES.some((r) => pathname?.startsWith(r))

  const fabRef = useRef<HTMLButtonElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Contexto de acceso del usuario: feature flags de la empresa + RBAC del
  // empleado. Espejo de lo que el sidebar usa para gatear secciones. Victoria no
  // sugiere ni enseña temas fuera del alcance del rol (la barrera real igual vive
  // server-side en authz.ts).
  const esEmpleado = userType === "empleado"
  const access = useMemo<VictoriaAccess>(
    () => ({ flags: featureFlags, permisos, esEmpleado, userType }),
    [featureFlags, permisos, esEmpleado, userType],
  )

  // Sugerencias generales, filtradas por flags + permisos del usuario
  // (no ofrecer temas apagados ni fuera del rol → evita rutas muertas/escalada UX).
  const suggestions = useMemo(() => topSuggestions(access, 4), [access])

  // Mensaje inicial: si la ruta actual tiene un tema asociado (y el usuario puede
  // usarlo), Victoria lo propone primero; si no, saludo genérico.
  const buildInitialMessage = useCallback((): Message => {
    const ctx = topicForPath(pathname)
    if (ctx && isTopicEnabled(ctx, access.flags, access.permisos, access.esEmpleado, access.userType)) {
      return { id: nextId(), role: "victoria", kind: "intro-contextual", topic: ctx }
    }
    return { id: nextId(), role: "victoria", kind: "intro" }
  }, [pathname, access])

  // El saludo refleja SIEMPRE la sección actual: se arma al montar y se rearma
  // cada vez que cambiás de sección (buildInitialMessage depende del pathname),
  // así Victoria detecta dónde estás y el botón contextual cambia con vos.
  useEffect(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current)
    setIsTyping(false)
    setMessages([buildInitialMessage()])
    setInput("")
  }, [buildInitialMessage])

  // Foco al input al abrir; devolver foco al FAB al cerrar.
  useEffect(() => {
    if (open) {
      const t = setTimeout(() => inputRef.current?.focus(), 60)
      return () => clearTimeout(t)
    }
    fabRef.current?.focus()
  }, [open])

  // Escape cierra el panel.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [open])

  // Auto-scroll al último mensaje / indicador de typing.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" })
  }, [messages, isTyping])

  // Limpieza del timer de typing al desmontar.
  useEffect(() => () => {
    if (typingTimer.current) clearTimeout(typingTimer.current)
  }, [])

  // Pulse de bienvenida: late 2-3 veces el primer mount de la sesión y se apaga.
  // Se omite si el usuario prefiere menos movimiento.
  useEffect(() => {
    if (pulseShownThisSession) return
    pulseShownThisSession = true
    if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    setShowPulse(true)
    const t = setTimeout(() => setShowPulse(false), 2400)
    return () => clearTimeout(t)
  }, [])

  const respond = useCallback((answer: PendingAnswer) => {
    setIsTyping(true)
    if (typingTimer.current) clearTimeout(typingTimer.current)
    typingTimer.current = setTimeout(() => {
      setMessages((prev) => [...prev, { id: nextId(), role: "victoria", ...answer }])
      setIsTyping(false)
    }, TYPING_MS)
  }, [])

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim()
      if (!text || isTyping) return
      setMessages((prev) => [...prev, { id: nextId(), role: "user", text }])
      setInput("")
      const matched = matchTopic(text)
      const gateReason = matched ? topicGateReasonFor(matched, access) : null
      if (!matched) {
        respond({ kind: "fallback" })
        logVictoriaFeedback({ tipo: "fallback", query: text, ruta: pathname ?? undefined })
      } else if (gateReason) {
        // El usuario preguntó por algo real pero fuera de su alcance (flag apagado
        // o permiso ausente): caemos en `gated` (solo título + a quién pedirle
        // acceso, SIN pasos), no lo mandamos a una sección que no puede usar.
        respond({ kind: "gated", topic: matched, reason: gateReason })
        logVictoriaFeedback({ tipo: "gated", topicId: matched.id, reason: gateReason, ruta: pathname ?? undefined })
      } else {
        respond({ kind: "topic", topic: matched })
        logVictoriaFeedback({ tipo: "match", topicId: matched.id, ruta: pathname ?? undefined })
      }
    },
    [isTyping, respond, access, pathname],
  )

  // Voto de una respuesta de tema: un voto por mensaje, irreversible. Marca el
  // mensaje y dispara telemetría fire-and-forget (no bloquea, traga errores).
  const voteTopic = useCallback(
    (messageId: number, topicId: string, voto: "up" | "down") => {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === "victoria" && m.kind === "topic" && !m.voted
            ? { ...m, voted: voto }
            : m,
        ),
      )
      logVictoriaFeedback({ tipo: "voto", topicId, voto, ruta: pathname ?? undefined })
    },
    [pathname],
  )

  const askTopic = useCallback(
    (topic: Topic) => {
      if (isTyping) return
      setMessages((prev) => [...prev, { id: nextId(), role: "user", text: topic.titulo }])
      // Los chips solo ofrecen temas accesibles, pero revalidamos por las dudas.
      const gateReason = topicGateReasonFor(topic, access)
      if (gateReason) {
        respond({ kind: "gated", topic, reason: gateReason })
        logVictoriaFeedback({ tipo: "gated", topicId: topic.id, reason: gateReason, ruta: pathname ?? undefined })
      } else {
        respond({ kind: "topic", topic })
        logVictoriaFeedback({ tipo: "match", topicId: topic.id, ruta: pathname ?? undefined })
      }
    },
    [isTyping, respond, access, pathname],
  )

  const resetChat = useCallback(() => {
    if (typingTimer.current) clearTimeout(typingTimer.current)
    setIsTyping(false)
    setMessages([buildInitialMessage()])
    setInput("")
    inputRef.current?.focus()
  }, [buildInitialMessage])

  const hasConversation = messages.some((m) => m.role === "user")

  return (
    <>
      {/* Panel */}
      {open ? (
        <div
          role="dialog"
          aria-label="Victoria, asistente de ayuda de TICKETERA"
          className={cn(
            "fixed z-50 flex flex-col overflow-hidden border border-border bg-popover text-popover-foreground",
            // Mobile: bottom-sheet pegado abajo, alto máx con dvh (sobrevive al teclado).
            "inset-x-0 bottom-0 max-h-[85dvh] rounded-t-card rounded-b-none",
            // Tablet/desktop: popover flotante anclado arriba del FAB.
            "sm:inset-x-auto sm:right-6 sm:w-[384px] sm:rounded-card",
            "sm:max-h-[min(70vh,560px)]",
            hasStickyBar ? "sm:bottom-[10.5rem]" : "sm:bottom-[5.25rem]",
            "shadow-[0_1px_2px_rgba(2,6,23,0.08),0_12px_32px_-8px_rgba(2,6,23,0.28)]",
            "sm:origin-bottom-right",
            "animate-in fade-in slide-in-from-bottom-8 duration-200 sm:slide-in-from-bottom-4 sm:zoom-in-95 motion-reduce:animate-none",
          )}
        >
          {/* Grabber (solo mobile / bottom-sheet) */}
          <div className="flex justify-center pt-2 pb-1 sm:hidden" aria-hidden>
            <span className="h-1 w-9 rounded-full bg-border" />
          </div>

          {/* Header */}
          <header className="flex items-center gap-2.5 border-b border-border px-3.5 py-3">
            <VictoriaAvatar className="size-9 text-sm" />
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-1.5 text-sm font-semibold leading-tight text-foreground">
                Victoria
                <Sparkles className="size-3 text-primary/70" aria-hidden />
              </p>
              <p className="truncate text-[12px] leading-tight text-muted-foreground">
                Te ayudo a usar TICKETERA
              </p>
            </div>
            {hasConversation ? (
              <button
                type="button"
                onClick={resetChat}
                aria-label="Empezar de nuevo"
                className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <RotateCcw className="size-4" />
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar ayuda"
              className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              <X className="size-4" />
            </button>
          </header>

          {/* Mensajes */}
          <div className="relative flex-1 overflow-hidden">
            {/* Fade-mask: el scroll no corta feo justo bajo el header. */}
            <div className="pointer-events-none absolute inset-x-0 top-0 z-10 h-4 bg-gradient-to-b from-popover to-transparent" />
            <div ref={scrollRef} className="h-full space-y-3 overflow-y-auto px-3.5 py-3.5">
            {messages.map((m, i) => {
              if (m.role === "user") {
                return (
                  <div
                    key={m.id}
                    className="flex justify-end animate-in fade-in slide-in-from-bottom-2 duration-150 motion-reduce:animate-none"
                  >
                    <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] leading-relaxed text-primary-foreground">
                      {m.text}
                    </p>
                  </div>
                )
              }
              // Agrupado: el avatar aparece solo en el primero de una racha de Victoria;
              // los siguientes quedan alineados con sangría izquierda (avatar 28px + gap 8px = 36px).
              const showAvatar = messages[i - 1]?.role !== "victoria"
              return (
                <div
                  key={m.id}
                  className={cn(
                    "flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150 motion-reduce:animate-none",
                    !showAvatar && "pl-9",
                  )}
                >
                  {showAvatar ? <VictoriaAvatar className="size-7 text-[12px]" /> : null}
                  <div className="max-w-[85%] rounded-2xl rounded-bl-md bg-muted px-3 py-2.5">
                    {m.kind === "intro" ? (
                      <div className="space-y-2.5">
                        <p className="text-[13px] leading-relaxed text-foreground/90">
                          ¡Hola! Soy Victoria. Contame qué querés hacer y te muestro cómo, o tocá una de estas:
                        </p>
                        <TopicChips topics={suggestions} onAskTopic={askTopic} />
                      </div>
                    ) : m.kind === "intro-contextual" ? (
                      <div className="space-y-2.5">
                        <p className="text-[13px] leading-relaxed text-foreground/90">
                          ¡Hola! Soy Victoria. Veo que estás en{" "}
                          <span className="font-semibold text-foreground">{m.topic.titulo}</span>
                          {" "}— ¿te muestro cómo funciona?
                        </p>
                        <Button
                          size="sm"
                          className="h-auto w-full whitespace-normal py-2 text-center leading-snug"
                          onClick={() => askTopic(m.topic)}
                        >
                          Sí, contame de {m.topic.titulo}
                          <ArrowRight data-icon="inline-end" />
                        </Button>
                        <div className="space-y-1.5 pt-0.5">
                          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">O preguntame otra cosa</p>
                          <TopicChips
                            topics={suggestions.filter((t) => t.id !== m.topic.id)}
                            onAskTopic={askTopic}
                          />
                        </div>
                      </div>
                    ) : m.kind === "topic" ? (
                      <TopicAnswer
                        topic={m.topic}
                        access={access}
                        voted={m.voted}
                        onAskTopic={askTopic}
                        onNavigate={() => setOpen(false)}
                        onVote={(voto) => voteTopic(m.id, m.topic.id, voto)}
                      />
                    ) : m.kind === "gated" ? (
                      <div className="space-y-2.5">
                        {/* En gated NUNCA mostramos el instructivo del tema: no enseñamos
                            a operar algo fuera del alcance del usuario. Solo el título, a
                            quién pedirle acceso y sugerencias de lo que sí puede usar.
                            (Contrato verificado por permisos.test.ts.) */}
                        <p className="text-[13px] leading-relaxed text-foreground/90">
                          <span className="font-semibold text-foreground">{m.topic.titulo}</span>{" "}
                          {m.reason === "permiso"
                            ? "no está dentro de tus permisos. Si necesitás acceso, pediselo a un administrador de tu equipo. Mientras tanto, puedo ayudarte con esto:"
                            : "no está habilitado en tu cuenta todavía. Si lo querés activar, escribile al equipo de TICKETERA. Mientras tanto, puedo ayudarte con esto:"}
                        </p>
                        <TopicChips topics={suggestions} onAskTopic={askTopic} />
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        <p className="text-[13px] leading-relaxed text-foreground/90">
                          Uf, de eso no estoy segura todavía. Probá preguntarme de otra forma, o elegí uno de estos temas:
                        </p>
                        <TopicChips topics={suggestions} onAskTopic={askTopic} />
                      </div>
                    )}
                  </div>
                </div>
              )
            })}

            {isTyping ? (
              <div className="flex items-start gap-2 animate-in fade-in slide-in-from-bottom-2 duration-150 motion-reduce:animate-none">
                <VictoriaAvatar className="size-7 text-[12px]" />
                <div className="rounded-2xl rounded-bl-md bg-muted px-3 py-2.5">
                  <TypingDots />
                </div>
              </div>
            ) : null}
            </div>
          </div>

          {/* Input */}
          <form
            className="flex items-center gap-2 border-t border-border px-3 py-2.5"
            onSubmit={(e) => {
              e.preventDefault()
              send(input)
            }}
          >
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Escribí tu pregunta…"
              aria-label="Escribí tu pregunta para Victoria"
              autoComplete="off"
              className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-input px-3 text-[13px] text-foreground placeholder:text-muted-foreground/70 focus-visible:border-ring focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
            />
            <Button
              type="submit"
              size="icon"
              className="size-9 shrink-0"
              disabled={!input.trim() || isTyping}
              aria-label="Enviar pregunta"
            >
              <ArrowUp />
            </Button>
          </form>
        </div>
      ) : null}

      {/* Botón flotante (FAB) */}
      {/* Wrapper fijo del tamaño del FAB: ancla pulse (inset-0) y micro-label (overflow a la izq).
          En mobile se oculta mientras el bottom-sheet está abierto (la X vive en el header). */}
      <div
        className={cn(
          "group fixed z-50 h-14 w-14",
          hasStickyBar ? "bottom-24 right-6" : "bottom-4 right-6",
          open && "max-sm:hidden",
        )}
      >
        {/* Pulse de bienvenida (primer mount de la sesión, off con reduced-motion). */}
        {showPulse && !open ? (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary/40 animate-ping motion-reduce:hidden"
          />
        ) : null}

        {/* Micro-label "Ayuda": aparece a la izquierda en hover/focus, solo sm+. */}
        {!open ? (
          <span
            aria-hidden
            className={cn(
              "pointer-events-none absolute right-full top-1/2 mr-3 hidden -translate-y-1/2 translate-x-1 whitespace-nowrap rounded-full",
              "border border-border bg-card px-2.5 py-1 text-[12px] text-foreground/80 opacity-0 shadow-sm sm:flex",
              "transition-[opacity,transform] duration-150",
              "group-hover:translate-x-0 group-hover:opacity-100 group-focus-within:translate-x-0 group-focus-within:opacity-100",
              "motion-reduce:translate-x-0 motion-reduce:transition-none",
            )}
          >
            Ayuda
          </span>
        ) : null}

        <button
          ref={fabRef}
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Cerrar ayuda de Victoria" : "Abrir ayuda de Victoria"}
          className={cn(
            "relative flex h-full w-full items-center justify-center rounded-full bg-primary text-primary-foreground",
            "shadow-[0_1px_2px_-1px_rgba(2,6,23,0.12),0_4px_12px_-2px_rgba(2,6,23,0.28),0_8px_24px_-8px_rgba(2,6,23,0.20)] dark:ring-1 dark:ring-white/10",
            "transition-transform duration-150 hover:scale-[1.04] active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
          )}
        >
          {open ? (
            <X className="size-6" />
          ) : (
            <>
              <MessageCircle aria-hidden className="size-6" />
              {/* Sparkle como firma, esquina superior derecha del círculo. */}
              <Sparkles aria-hidden className="absolute right-1 top-1 size-2.5 text-primary-foreground/70" />
            </>
          )}
        </button>
      </div>
    </>
  )
}
