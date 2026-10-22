// Telemetría de Victoria — fire-and-forget hacia nuestro propio backend (vía BFF).
//
// Reglas duras:
// - NUNCA se awaitea: no bloquea el render ni la conversación.
// - Traga TODOS los errores (red caída, 5xx, navegación): la ayuda nunca rompe.
// - keepalive:true para sobrevivir una navegación inmediata (el fallback suele
//   dispararse y el usuario puede cambiar de ruta acto seguido).
//
// No hay API paga ni LLM detrás: esto va a POST /api/victoria/feedback (BFF → Express).

export type VictoriaFeedbackPayload =
  | { tipo: "fallback"; query: string; ruta?: string }
  | { tipo: "voto"; topicId: string; voto: "up" | "down"; ruta?: string }
  | { tipo: "match"; topicId: string; ruta?: string }
  | { tipo: "gated"; topicId: string; reason: "permiso" | "flag"; ruta?: string }

export function logVictoriaFeedback(payload: VictoriaFeedbackPayload): void {
  void fetch("/api/victoria/feedback", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {})
}
