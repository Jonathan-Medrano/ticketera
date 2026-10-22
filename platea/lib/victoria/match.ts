// Victoria — motor de matching rule-based (sin LLM, sin API).
//
// Normaliza la consulta (minúsculas, sin tildes, sin puntuación), tokeniza y
// scorea cada tema por solapamiento de keywords. Devuelve el mejor tema o null
// si nada supera el umbral mínimo de confianza.

import { TOPICS, TOPIC_BY_ID, type FeatureFlags, type Topic } from "./knowledge"
import { puedeHacer, type Permisos } from "@/lib/permisos"
import { canAccessVentasNav } from "@/lib/dashboard-ventas"

/** Palabras vacías que no aportan señal y meterían ruido en el overlap. */
const STOPWORDS = new Set([
  "el", "la", "los", "las", "un", "una", "unos", "unas", "de", "del", "al",
  "a", "en", "y", "o", "u", "que", "como", "cómo", "donde", "dónde", "cuando",
  "cuándo", "cual", "cuál", "por", "para", "con", "sin", "se", "me", "mi", "mis",
  "tu", "tus", "su", "sus", "es", "son", "hay", "muy", "mas", "más", "esto",
  "esta", "este", "eso", "ese", "lo", "le", "yo", "vos", "hacer", "puedo",
  "quiero", "necesito", "tengo", "porfa", "porfavor", "por favor", "ayuda",
  "ayudame", "ayúdame", "decime", "explicame", "explícame",
])

/** Normaliza: minúsculas, sin diacríticos, sin puntuación, espacios colapsados. */
export function normalize(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita tildes/diacríticos
    .replace(/[^a-z0-9\s]/g, " ") // puntuación -> espacio
    .replace(/\s+/g, " ")
    .trim()
}

function tokenize(normalized: string): string[] {
  return normalized.split(" ").filter(Boolean)
}

/** Tokens significativos: descarta stopwords y tokens de 1 caracter. */
function meaningfulTokens(tokens: string[]): string[] {
  return tokens.filter((t) => t.length > 1 && !STOPWORDS.has(t))
}

interface ScoredTopic {
  topic: Topic
  score: number
}

const PHRASE_WEIGHT = 4 // keyword multi-palabra que aparece literal en la query
const EXACT_TOKEN_WEIGHT = 2 // token de query == token de keyword
const PARTIAL_TOKEN_WEIGHT = 1 // token de query prefijo de un token de keyword (typos/plurales)
const TITLE_TOKEN_WEIGHT = 1.5 // token de query presente en el título del tema
const MIN_SCORE = 2 // umbral de confianza mínima para devolver match

function scoreTopic(topic: Topic, queryNorm: string, queryTokens: string[]): number {
  let score = 0
  const queryTokenSet = new Set(queryTokens)

  // Tokens del set de keywords (para overlap token a token).
  const keywordTokens = new Set<string>()
  for (const kw of topic.keywords) {
    const kwNorm = normalize(kw)
    // Frase multi-palabra que aparece literal en la consulta -> señal fuerte.
    if (kwNorm.includes(" ") && queryNorm.includes(kwNorm)) {
      score += PHRASE_WEIGHT
    }
    for (const t of meaningfulTokens(tokenize(kwNorm))) keywordTokens.add(t)
  }

  // Overlap token a token (exacto y parcial por prefijo).
  for (const qt of queryTokenSet) {
    if (keywordTokens.has(qt)) {
      score += EXACT_TOKEN_WEIGHT
      continue
    }
    if (qt.length >= 4) {
      for (const kt of keywordTokens) {
        if (kt.startsWith(qt) || qt.startsWith(kt)) {
          score += PARTIAL_TOKEN_WEIGHT
          break
        }
      }
    }
  }

  // Tokens del título (refuerza el tema canónico).
  for (const tt of meaningfulTokens(tokenize(normalize(topic.titulo)))) {
    if (queryTokenSet.has(tt)) score += TITLE_TOKEN_WEIGHT
  }

  return score
}

/**
 * Devuelve el mejor tema para la consulta, o `null` si nada supera el umbral.
 */
export function matchTopic(query: string): Topic | null {
  const queryNorm = normalize(query)
  if (!queryNorm) return null
  const queryTokens = meaningfulTokens(tokenize(queryNorm))
  if (queryTokens.length === 0) return null

  const ranked: ScoredTopic[] = TOPICS
    .map((topic) => ({ topic, score: scoreTopic(topic, queryNorm, queryTokens) }))
    .sort((a, b) => b.score - a.score)

  const best = ranked[0]
  if (!best || best.score < MIN_SCORE) return null
  return best.topic
}

/**
 * Contexto de acceso del usuario actual del dashboard. Espejo de lo que el
 * sidebar usa para gatear secciones: feature flags de la empresa + RBAC del
 * empleado. `userType` se necesita para el caso especial `ventas`.
 */
export interface VictoriaAccess {
  flags?: FeatureFlags
  permisos?: Permisos
  esEmpleado: boolean
  userType?: string
}

/**
 * Por qué un tema queda bloqueado para el usuario, o `null` si está habilitado.
 *   - `"flag"`    → la función está apagada a nivel cuenta (la activa TICKETERA).
 *   - `"permiso"` → el rol del empleado no incluye el permiso (lo da un admin).
 * La distinción importa para el copy del estado `gated`: a quién pedirle acceso
 * cambia según el motivo.
 */
export type GateReason = "flag" | "permiso"

/**
 * Evalúa las DOS barreras del tema (espejo del sidebar) y devuelve el motivo de
 * bloqueo, o `null` si el usuario puede usarlo:
 *   1. Feature flag de la empresa (opt-out: solo bloquea si el flag === false).
 *   2. Permiso RBAC del empleado (`requierePermiso`). `ventas` es especial: su
 *      acceso depende de tabs visibles → `canAccessVentasNav` (no dupica lógica).
 * El flag tiene precedencia: si la función está apagada, da igual el permiso.
 *
 * IMPORTANTE: esto es solo UX (no enseñar pasos de algo que el rol no puede
 * hacer). La barrera REAL es server-side (`authz.ts`), que revalida cada acción.
 */
export function topicGateReason(
  topic: Topic,
  flags?: FeatureFlags,
  permisos?: Permisos,
  esEmpleado = false,
  userType?: string,
): GateReason | null {
  // 1. Feature flag (semántica opt-out, idéntica al sidebar).
  if (topic.requiereFlag && flags && flags[topic.requiereFlag] === false) return "flag"

  // 2. Caso especial `ventas`: acceso por tabs visibles, no por un permiso único.
  if (topic.id === "ventas") {
    const ok = canAccessVentasNav({ permisos, userType: userType ?? (esEmpleado ? "empleado" : undefined) })
    return ok ? null : "permiso"
  }

  // 3. Permiso RBAC. `puedeHacer` ya trata empresa/super-admin como acceso total
  //    y a un empleado con permisos undefined como denegado (fail-closed).
  if (topic.requierePermiso && !puedeHacer(topic.requierePermiso, esEmpleado, permisos)) {
    return "permiso"
  }

  return null
}

/** ¿El tema está habilitado (sin ningún bloqueo) para este usuario? */
export function isTopicEnabled(
  topic: Topic,
  flags?: FeatureFlags,
  permisos?: Permisos,
  esEmpleado = false,
  userType?: string,
): boolean {
  return topicGateReason(topic, flags, permisos, esEmpleado, userType) === null
}

/** Igual que `topicGateReason` pero tomando el contexto de acceso agrupado. */
export function topicGateReasonFor(topic: Topic, access: VictoriaAccess): GateReason | null {
  return topicGateReason(topic, access.flags, access.permisos, access.esEmpleado, access.userType)
}

/**
 * Temas sugeridos para los chips iniciales (orden curado del KB), filtrando los
 * que el usuario no puede usar (flag apagado o permiso ausente) para no ofrecer
 * rutas muertas ni enseñar secciones fuera de su rol.
 */
export function topSuggestions(access: VictoriaAccess, limit = 4): Topic[] {
  const { flags, permisos, esEmpleado, userType } = access
  return TOPICS.filter(
    (t) => !t.ocultarEnSugerencias && isTopicEnabled(t, flags, permisos, esEmpleado, userType),
  ).slice(0, limit)
}

/** Resuelve los temas relacionados de un tema, omitiendo los no accesibles. */
export function relatedTopics(topic: Topic, access: VictoriaAccess): Topic[] {
  if (!topic.relacionados) return []
  const { flags, permisos, esEmpleado, userType } = access
  return topic.relacionados
    .map((id) => TOPIC_BY_ID[id])
    .filter((t): t is Topic => Boolean(t))
    .filter((t) => isTopicEnabled(t, flags, permisos, esEmpleado, userType))
}
