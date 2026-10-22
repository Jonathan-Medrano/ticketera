import { Router, Request, Response } from 'express'
import bcrypt from 'bcryptjs'
import { randomUUID as uuidv4 } from 'node:crypto'
import { prisma } from '../lib/prisma'
import { getRequestIp, getRequestUserAgent, verifyInternal } from '../middleware/auth'
import { assertInternalEmailAvailable } from '../lib/internal-email'
import { ensureIdentityConstraints } from '../lib/identity-constraints'
import { assertTenantSlugAvailable, validateTenantSlug } from '../lib/tenant-slug'
import { consumePasswordReset, requestPasswordReset, type PasswordResetActor } from '../lib/password-reset'
import { sendEmailVerificationCode, verifyEmailCode, confirmEmailByLinkToken } from '../lib/email-verification'
import { getAutoAprobarEmpresas } from '../lib/platform-settings'
import { sendEmpresaApprovedEmail } from '../lib/empresa-approved-email'
import { logServerError } from '../lib/safe-log'
import { getDefaultSupportFaqs } from '../lib/support-faqs'
import { buildPasswordPolicyError, validatePasswordPolicy } from '../lib/password-policy'

const router = Router()

// GET /auth/check-slug?slug=xxx — pública (solo verifyInternal).
// Devuelve { available: boolean } si el slug es válido, o 400 { error: "invalid" }
// si el formato no cumple las mismas reglas que el registro.
// No expone ningún dato de la empresa propietaria del slug.
router.get('/check-slug', verifyInternal, async (req: Request, res: Response) => {
  try {
    const slug = typeof req.query.slug === 'string' ? req.query.slug : ''
    const validation = validateTenantSlug(slug)

    if (!validation.ok) {
      return res.status(400).json({ error: 'invalid' })
    }

    const exists = await prisma.empresa.findFirst({
      where: { slug: validation.slug },
      select: { id: true },
    })

    return res.json({ available: !exists })
  } catch (error) {
    logServerError('auth check-slug', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /auth/registro — pública (solo verifyInternal)
router.post('/registro', verifyInternal, async (req: Request, res: Response) => {
  try {
    const { nombre, slug, email, password, admin_nombre, admin_apellido } = req.body

    if (!nombre || !slug || !email || !password || !admin_nombre) {
      return res.status(400).json({ error: 'Todos los campos obligatorios son requeridos' })
    }

    await ensureIdentityConstraints()
    const normalizedEmail = await assertInternalEmailAvailable(email)
    const normalizedSlug = await assertTenantSlugAvailable(slug)
    const validation = validatePasswordPolicy(password)
    if (!validation.ok) {
      return res.status(400).json(buildPasswordPolicyError(validation.reason))
    }

    const hashedPassword = await bcrypt.hash(password, 12)
    const id = uuidv4()

    // Si el superadmin activó la auto-aprobación, la empresa queda aprobada al
    // instante; si no, queda pendiente hasta aprobación manual. Best-effort: ante
    // cualquier error leyendo el flag, fallamos seguro a "pendiente" (false).
    let autoAprobar = false
    try {
      autoAprobar = await getAutoAprobarEmpresas()
    } catch (error) {
      logServerError('auth registro auto-aprobacion flag', error)
    }

    await prisma.empresa.create({
      data: {
        id,
        nombre,
        slug: normalizedSlug,
        // email is stored lowercased per design
        email: normalizedEmail,
        password: hashedPassword,
        admin_nombre,
        admin_apellido: admin_apellido ?? null,
        faqs: JSON.stringify(getDefaultSupportFaqs()),
        // Registro público: pendiente hasta aprobación manual, salvo que la
        // auto-aprobación esté activa (entonces aprobada al instante).
        aprobada: autoAprobar,
        aprobada_at: autoAprobar ? new Date() : null,
        // El email arranca sin verificar; se confirma con el código de 6 dígitos.
        // La verificación de email y la aprobación son gates separados.
        email_verificado: false,
      },
    })

    // Si quedó auto-aprobada, avisamos por email (best-effort, no rompe el 201).
    if (autoAprobar) {
      try {
        await sendEmpresaApprovedEmail({
          email: normalizedEmail,
          nombre,
          adminNombre: admin_nombre,
        })
      } catch (error) {
        logServerError('auth registro send approved email', error)
      }
    }

    // Enviar el primer código de verificación (best-effort: si falla, el usuario
    // puede reenviar — no rompemos el 201).
    try {
      await sendEmailVerificationCode({
        empresaId: id,
        email: normalizedEmail,
        ip: req.requestMeta?.ip ?? getRequestIp(req),
      })
    } catch (error) {
      logServerError('auth registro send verification code', error)
    }

    return res.status(201).json({ ok: true })
  } catch (error) {
    if (error instanceof Error && error.message === 'El email ya está en uso por otra cuenta interna') {
      return res.status(409).json({ error: error.message })
    }
    if (error instanceof Error && (error.message === 'El subdominio ya está en uso' || error.message.startsWith('El subdominio') || error.message === 'Ese subdominio está reservado y no se puede usar')) {
      return res.status(error.message === 'El subdominio ya está en uso' ? 409 : 400).json({ error: error.message })
    }
    logServerError('auth registro')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /auth/password/forgot
router.post('/password/forgot', verifyInternal, async (req: Request, res: Response) => {
  try {
    const actor = req.body?.actor === 'empleado' ? 'empleado' : 'empresa'
    const result = await requestPasswordReset({
      actorType: actor as Extract<PasswordResetActor, 'empresa' | 'empleado'>,
      email: typeof req.body?.email === 'string' ? req.body.email : '',
      requestIp: req.requestMeta?.ip ?? getRequestIp(req),
      requestUserAgent: req.requestMeta?.userAgent ?? getRequestUserAgent(req),
    })

    if (!result.ok) {
      return res.status(result.status).json(result)
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('auth password forgot')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /auth/password/reset
router.post('/password/reset', verifyInternal, async (req: Request, res: Response) => {
  try {
    const actor = req.body?.actor === 'empleado' ? 'empleado' : 'empresa'
    const result = await consumePasswordReset({
      actorType: actor as Extract<PasswordResetActor, 'empresa' | 'empleado'>,
      token: typeof req.body?.token === 'string' ? req.body.token : '',
      nuevaPassword: typeof req.body?.nuevaPassword === 'string' ? req.body.nuevaPassword : '',
      confirmarPassword: typeof req.body?.confirmarPassword === 'string' ? req.body.confirmarPassword : '',
      consumedIp: req.requestMeta?.ip ?? getRequestIp(req),
      consumedUserAgent: req.requestMeta?.userAgent ?? getRequestUserAgent(req),
    })

    if (!result.ok) {
      return res.status(result.status).json(result)
    }

    return res.status(result.status).json(result.data)
  } catch {
    logServerError('auth password reset')
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /auth/verify-email — pública (solo verifyInternal)
router.post('/verify-email', verifyInternal, async (req: Request, res: Response) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : ''
    const code = typeof req.body?.code === 'string' ? req.body.code : ''

    const result = await verifyEmailCode({
      email,
      code,
      ip: req.requestMeta?.ip ?? getRequestIp(req),
    })

    if (result.ok) {
      return res.status(200).json({ ok: true })
    }

    if (result.reason === 'expired') {
      return res.status(410).json({ error: 'El código expiró. Pedí uno nuevo.' })
    }
    if (result.reason === 'too_many_attempts') {
      return res.status(410).json({ error: 'Demasiados intentos. Pedí un código nuevo.' })
    }
    if (result.reason === 'not_found') {
      return res.status(400).json({ error: 'Código inválido' })
    }
    return res.status(400).json({ error: 'Código inválido' })
  } catch (error) {
    logServerError('auth verify-email', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /auth/verify-email/confirm — pública (solo verifyInternal).
// Confirma el email vía magic-link (token de un solo uso del email de verificación).
router.post('/verify-email/confirm', verifyInternal, async (req: Request, res: Response) => {
  try {
    const token = typeof req.body?.token === 'string' ? req.body.token : ''

    const result = await confirmEmailByLinkToken(token)

    if (result.ok) {
      return res.status(200).json({ ok: true })
    }

    if (result.reason === 'expired') {
      return res.status(410).json({ error: 'El enlace expiró. Pedí un código nuevo desde la página de verificación.' })
    }
    return res.status(400).json({ error: 'El enlace no es válido o ya fue utilizado.' })
  } catch (error) {
    logServerError('auth verify-email confirm', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

// POST /auth/verify-email/resend — pública (solo verifyInternal).
// SIEMPRE 200 para no filtrar si el email existe.
router.post('/verify-email/resend', verifyInternal, async (req: Request, res: Response) => {
  try {
    const rawEmail = typeof req.body?.email === 'string' ? req.body.email : ''
    const email = rawEmail.trim().toLowerCase()

    if (email) {
      const empresa = await prisma.empresa.findFirst({
        where: { email },
        select: { id: true, email_verificado: true },
      })

      if (empresa && !empresa.email_verificado) {
        try {
          await sendEmailVerificationCode({
            empresaId: empresa.id,
            email,
            ip: req.requestMeta?.ip ?? getRequestIp(req),
          })
        } catch (error) {
          logServerError('auth verify-email resend send', error)
        }
      }
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    logServerError('auth verify-email resend', error)
    return res.status(500).json({ error: 'Error interno del servidor' })
  }
})

export default router
