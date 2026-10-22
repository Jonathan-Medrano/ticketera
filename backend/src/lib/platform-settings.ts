import { prisma } from './prisma'

// Tabla singleton: una sola fila identificada por este id.
const PLATFORM_SETTINGS_ID = 'singleton'

export interface PlatformSettings {
  id: string
  auto_aprobar_empresas: boolean
  vidriera_habilitada: boolean
  vidriera_habilitada_at: Date | null
  updated_at: Date
  updated_by: string | null
}

/** Empresas elegibles mínimas para que la vidriera se encienda por primera vez. */
export const VIDRIERA_MIN_EMPRESAS = 2

/**
 * Lee la fila singleton de configuración de plataforma. Si no existe todavía
 * (DB recién migrada sin la semilla, o entorno de test), la crea con defaults
 * (auto_aprobar_empresas = false) y la devuelve. Idempotente.
 */
export async function getPlatformSettings(): Promise<PlatformSettings> {
  const existing = await prisma.platformSetting.findUnique({
    where: { id: PLATFORM_SETTINGS_ID },
  })
  if (existing) {
    return existing
  }

  // No estaba sembrada: la creamos con defaults. upsert para tolerar carreras.
  return prisma.platformSetting.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {},
    create: { id: PLATFORM_SETTINGS_ID, auto_aprobar_empresas: false },
  })
}

/**
 * Flag de auto-aprobación de empresas en el registro público.
 */
export async function getAutoAprobarEmpresas(): Promise<boolean> {
  const settings = await getPlatformSettings()
  return settings.auto_aprobar_empresas
}

/**
 * Actualiza el flag de auto-aprobación (upsert sobre la fila singleton).
 */
export async function setAutoAprobarEmpresas(value: boolean, updatedBy?: string): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: { auto_aprobar_empresas: value, updated_by: updatedBy ?? null },
    create: { id: PLATFORM_SETTINGS_ID, auto_aprobar_empresas: value, updated_by: updatedBy ?? null },
  })
}

/**
 * Gate de la vidriera cross-tenant, con semántica de LATCH.
 *
 * - Si ya está encendida, devuelve true sin consultar nada más. Nunca se apaga sola:
 *   /eventos es una página pública indexable, y que aparezca y desaparezca según cuántas
 *   empresas hay en ese momento rompería el SEO y los links ya compartidos.
 * - Si está apagada, cuenta empresas elegibles CON al menos un evento listado a futuro
 *   (mismos criterios de elegibilidad que la query de /vidriera/eventos) y la enciende
 *   cuando llega a VIDRIERA_MIN_EMPRESAS.
 *
 * Apagarla es una decisión manual y deliberada: para eso está setVidrieraHabilitada.
 */
export async function isVidrieraHabilitada(): Promise<boolean> {
  const settings = await getPlatformSettings()
  if (settings.vidriera_habilitada) return true

  const [row] = await prisma.$queryRaw<{ empresas: bigint }[]>`
    SELECT COUNT(DISTINCT em.id) AS empresas
    FROM empresas em
    JOIN eventos e ON e.empresa_id = em.id AND e.activo = TRUE
    JOIN (
      SELECT evento_id, MIN(fecha) AS proxima_fecha
      FROM evento_fechas
      GROUP BY evento_id
    ) ef ON ef.evento_id = e.id AND ef.proxima_fecha >= NOW()
    WHERE em.activa = TRUE
      AND em.aprobada = TRUE
      AND COALESCE(em.email_verificado, TRUE) = TRUE
      AND COALESCE(em.es_prueba, FALSE) = FALSE
      AND COALESCE(em.suspendido, FALSE) = FALSE
      AND COALESCE(em.tenant_public_disabled, FALSE) = FALSE
      AND COALESCE(em.vidriera_disabled, FALSE) = FALSE
  `

  if (Number(row?.empresas ?? 0) < VIDRIERA_MIN_EMPRESAS) return false

  await setVidrieraHabilitada(true, 'auto:gate')
  return true
}

/**
 * Enciende o apaga la vidriera a mano. Apagarla es una decisión de plataforma
 * (no la revierte el gate automático, que solo enciende).
 */
export async function setVidrieraHabilitada(value: boolean, updatedBy?: string): Promise<void> {
  await prisma.platformSetting.upsert({
    where: { id: PLATFORM_SETTINGS_ID },
    update: {
      vidriera_habilitada: value,
      vidriera_habilitada_at: value ? new Date() : null,
      updated_by: updatedBy ?? null,
    },
    create: {
      id: PLATFORM_SETTINGS_ID,
      vidriera_habilitada: value,
      vidriera_habilitada_at: value ? new Date() : null,
      updated_by: updatedBy ?? null,
    },
  })
}
