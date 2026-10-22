import { prismaDirectUrl } from '../lib/prisma'
import { Resend } from 'resend'
import { sendEmailWithRetry } from '../lib/resend-retry'
import { logServerError, logServerInfo } from '../lib/safe-log'
import { buildUnsubscribeToken } from '../routes/marketing'

export const MARKETING_CARRITO_ABANDONADO_INTERVAL_MS = 15 * 60 * 1000

const CARRITO_ABANDONADO_JOB_STATE_KEY = Symbol.for('platea.backend.marketingCarritoAbandonadoJob')

let carritoAbandonadoRunning = false

type CarritoAbandonadoJobTimer = ReturnType<typeof setInterval>
type CarritoAbandonadoJobState = {
  timer: CarritoAbandonadoJobTimer | null
}

function getCarritoAbandonadoJobState(): CarritoAbandonadoJobState {
  const scope = globalThis as typeof globalThis & {
    [CARRITO_ABANDONADO_JOB_STATE_KEY]?: CarritoAbandonadoJobState
  }

  if (!scope[CARRITO_ABANDONADO_JOB_STATE_KEY]) {
    scope[CARRITO_ABANDONADO_JOB_STATE_KEY] = { timer: null }
  }

  return scope[CARRITO_ABANDONADO_JOB_STATE_KEY]
}

export function shouldStartMarketingCarritoAbandonadoJob(env: NodeJS.ProcessEnv = process.env) {
  if (env.MARKETING_CARRITO_ABANDONADO_ENABLED === '0') {
    return false
  }

  if (env.NODE_ENV === 'test' && env.MARKETING_CARRITO_ABANDONADO_ENABLE_IN_TESTS !== '1') {
    return false
  }

  if (env.BACKEND_MIGRATION_MODE === '1' || env.MIGRATION_RUNNING === '1') {
    return false
  }

  return true
}

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

function getFromEmail(): string {
  const from = process.env.RESEND_FROM_EMAIL
  if (!from && process.env.NODE_ENV === 'production') {
    throw new Error('RESEND_FROM_EMAIL is required in production')
  }
  return from ?? 'onboarding@resend.dev'
}

const resendFromEmail = getFromEmail()

// Unique advisory lock key for this job — stable integer, no collision with other jobs
const CARRITO_ABANDONADO_LOCK_KEY = 7701

type EmpresaRow = {
  id: string
  email_marketing_from: string | null
  email_marketing_from_name: string | null
  marketing_carrito_ventana_min: number
  marketing_carrito_ventana_max: number
}

type CheckoutRow = {
  checkout_session_id: string
  comprador_id: string
  email: string
  nombre: string | null
  apellido: string | null
}

export async function runMarketingCarritoAbandonadoJob() {
  if (carritoAbandonadoRunning) {
    return 0
  }

  carritoAbandonadoRunning = true
  let totalEnviados = 0

  // pg_try_advisory_lock — non-blocking, returns false if another instance holds it.
  // Uses prismaDirectUrl (direct port 5432) because advisory locks are session-scoped
  // and incompatible with PgBouncer transactional mode.
  const lockResult = await prismaDirectUrl.$queryRaw<{ acquired: boolean }[]>`
    SELECT pg_try_advisory_lock(${CARRITO_ABANDONADO_LOCK_KEY}) AS acquired
  `
  if (!lockResult[0]?.acquired) {
    carritoAbandonadoRunning = false
    return 0
  }

  try {
    // Buscar empresas con email marketing habilitado
    const empresas = await prismaDirectUrl.$queryRaw<EmpresaRow[]>`
      SELECT id, email_marketing_from, email_marketing_from_name,
             marketing_carrito_ventana_min, marketing_carrito_ventana_max
      FROM empresas
      WHERE email_marketing_habilitado = TRUE
    `

    for (const empresa of empresas) {
      try {
        const empresaId = String(empresa.id)

        // Buscar checkouts expirados en la ventana configurable sin compra posterior y sin envío previo
        const ventanaMinMins = empresa.marketing_carrito_ventana_min ?? 60
        const ventanaMaxMins = empresa.marketing_carrito_ventana_max ?? 120
        const checkouts = await prismaDirectUrl.$queryRaw<CheckoutRow[]>`
          SELECT cs.id AS checkout_session_id, cs.comprador_id,
                 c.email, c.nombre, c.apellido
          FROM checkout_sessions cs
          JOIN compradores c ON c.id = cs.comprador_id
          WHERE cs.empresa_id = ${empresaId}
            AND cs.estado = 'expirada'
            AND cs.comprador_id IS NOT NULL
            AND cs.expires_at >= NOW() - (${ventanaMaxMins} * INTERVAL '1 minute')
            AND cs.expires_at < NOW() - (${ventanaMinMins} * INTERVAL '1 minute')
            AND c.email IS NOT NULL AND c.email != ''
            AND c.email_marketing_opt_out = FALSE
            AND NOT EXISTS (
              SELECT 1 FROM entradas en
              WHERE en.comprador_id = cs.comprador_id
                AND en.empresa_id = ${empresaId}
                AND en.estado != 'cancelada'
                AND en.created_at > cs.expires_at
            )
            AND NOT EXISTS (
              SELECT 1 FROM marketing_envios me
              WHERE me.checkout_session_id = cs.id
            )
        `

        // from: SIEMPRE el sender verificado de TICKETERA (RESEND_FROM_EMAIL) para no rebotar/spam
        // por dominios sin verificar. El email configurado por la empresa pasa a reply-to y su
        // nombre al display name.
        // TODO: verificación de dominio por-empresa vía Resend Domains API es la solución futura
        // correcta para enviar desde el dominio propio de cada empresa.
        const fromName = empresa.email_marketing_from_name || null
        const fromHeader = fromName ? `${fromName} <${resendFromEmail}>` : resendFromEmail
        const replyTo = empresa.email_marketing_from ? String(empresa.email_marketing_from).trim() : null

        const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:3000'

        const escHtml = (s: string) =>
          s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

        const sendOne = async (checkout: CheckoutRow) => {
          try {
            const nombre = [checkout.nombre, checkout.apellido].filter(Boolean).join(' ') || 'cliente'

            // Registrar envío antes de enviar para evitar duplicados en caso de retry.
            // Si ya existe un registro para este checkout (unique key en checkout_session_id),
            // otra instancia lo procesó concurrentemente — saltar silenciosamente.
            let envioId: number
            try {
              const insertResult = await prismaDirectUrl.$queryRaw<{ id: number }[]>`
                INSERT INTO marketing_envios
                  (campana_id, comprador_id, checkout_session_id, estado)
                VALUES (NULL, ${checkout.comprador_id}, ${String(checkout.checkout_session_id)}, 'pendiente')
                RETURNING id
              `
              envioId = insertResult[0].id
            } catch (insertErr: unknown) {
              // Postgres unique violation code: 23505
              if ((insertErr as { code?: string }).code === '23505') return 0
              throw insertErr
            }

            if (!resend) {
              // Proveedor de email no configurado: marcar como omitido, no como enviado
              await prismaDirectUrl.$executeRaw`
                UPDATE marketing_envios SET estado = 'error', error_mensaje = 'sin_proveedor' WHERE id = ${envioId}
              `
              return 0
            }

            const token = buildUnsubscribeToken(String(checkout.comprador_id), empresaId)
            const unsubscribeUrl = `${frontendUrl}/api/marketing/unsubscribe?token=${token}`

            const result = await sendEmailWithRetry(resend, {
              from: fromHeader,
              to: String(checkout.email),
              ...(replyTo ? { replyTo } : {}),
              subject: '¿Olvidaste completar tu compra?',
              html: `
                <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto; padding: 24px;">
                  <h2 style="color: #1a1a1a;">Hola ${escHtml(nombre)},</h2>
                  <p style="color: #444; font-size: 16px; line-height: 1.6;">
                    Notamos que dejaste una compra sin completar. ¡Todavía estás a tiempo de conseguir tus entradas!
                  </p>
                  <p style="color: #444; font-size: 16px; line-height: 1.6;">
                    Volvé a nuestro sitio y retomá tu compra antes de que se agoten los lugares disponibles.
                  </p>
                  <p style="color: #888; font-size: 13px; margin-top: 32px;">
                    Si ya completaste tu compra, ignorá este mensaje.
                  </p>
                  <p style="text-align:center;color:#999;font-size:12px;margin-top:32px">
                    <a href="${unsubscribeUrl}" style="color:#999">Darse de baja</a>
                  </p>
                </div>
              `,
              headers: {
                'List-Unsubscribe': '<' + unsubscribeUrl + '>',
                'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
              },
            })

            const resendId = result?.data?.id ?? null
            const resendError = result?.error

            if (!resendId) {
              // Resend respondió pero sin ID — puede ser error de la API
              const errMsg = resendError
                ? (typeof resendError === 'object' && 'message' in resendError ? String((resendError as { message?: unknown }).message) : String(resendError)).slice(0, 500)
                : 'resend_no_id'
              await prismaDirectUrl.$executeRaw`
                UPDATE marketing_envios SET estado = 'error', error_mensaje = ${errMsg} WHERE id = ${envioId}
              `
              return 0
            }

            await prismaDirectUrl.$executeRaw`
              UPDATE marketing_envios
              SET estado = 'enviado', resend_id = ${resendId}, enviado_at = NOW()
              WHERE id = ${envioId}
            `

            return 1
          } catch {
            logServerError(`marketing carrito abandonado envio comprador ${checkout.comprador_id}`)
            return 0
          }
        }

        // Batching por chunks para respetar el rate limit de Resend (espeja runCampanaEnvioAsync).
        // La idempotencia se mantiene en sendOne (insert-before-send en marketing_envios + skip 23505).
        const BATCH_SIZE = 50
        const BATCH_DELAY_MS = 1000

        for (let i = 0; i < checkouts.length; i += BATCH_SIZE) {
          if (i > 0) await new Promise<void>((resolve) => setTimeout(resolve, BATCH_DELAY_MS))
          const batch = checkouts.slice(i, i + BATCH_SIZE)
          const results = await Promise.all(batch.map(sendOne))
          totalEnviados += results.reduce<number>((acc, v) => acc + v, 0)
        }
      } catch {
        logServerError(`marketing carrito abandonado empresa ${empresa.id}`)
      }
    }

    if (totalEnviados > 0) {
      logServerInfo(`[marketing carrito abandonado] ${totalEnviados} emails enviados`)
    }

    return totalEnviados
  } catch {
    logServerError('marketing carrito abandonado job')
    return 0
  } finally {
    carritoAbandonadoRunning = false
    await prismaDirectUrl.$queryRaw`SELECT pg_advisory_unlock(${CARRITO_ABANDONADO_LOCK_KEY})`.catch(() => { /* ignoro errores del release */ })
  }
}

export function startMarketingCarritoAbandonadoJob(intervalMs = MARKETING_CARRITO_ABANDONADO_INTERVAL_MS) {
  if (!shouldStartMarketingCarritoAbandonadoJob()) {
    return null
  }

  const state = getCarritoAbandonadoJobState()
  if (state.timer) {
    return state.timer
  }

  state.timer = setInterval(() => {
    void runMarketingCarritoAbandonadoJob()
  }, intervalMs)

  state.timer.unref?.()

  return state.timer
}

export function stopMarketingCarritoAbandonadoJob() {
  const state = getCarritoAbandonadoJobState()

  if (state.timer) {
    clearInterval(state.timer)
    state.timer = null
  }
}
