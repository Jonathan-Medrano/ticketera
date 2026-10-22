import { cache } from "react"
import type { Session } from "next-auth"
import { redirect } from "next/navigation"
import { auth } from "@/auth"
import { getDashboardFirstAccessiblePath } from "@/lib/dashboard-ventas"
import { getPlatformConsoleHomePath, isPlatformConsoleActor } from "@/lib/internal-actor-routing"
import { esRolRevendedor, type Permisos } from "@/lib/permisos"

export type DashboardAuthContext = {
  session: Session
  permisos: Permisos | undefined
  esEmpleado: boolean
}

export const getCachedSession = cache(() => auth())

export async function requireDashboardSession(): Promise<DashboardAuthContext> {
  const session = await getCachedSession()

  if (!session) redirect("/login?reason=session")
  if (!session.user.id) redirect("/login?reason=session")
  if (!session.user.userType) redirect("/login?reason=session")
  if (session.user.userType === "comprador") redirect("/")

  const permisos = session.user.permisos as Permisos | undefined
  const esEmpleado = session.user.userType === "empleado"
  const mustChangePassword = session.user.mustChangePassword === true

  // Early return mustChangePassword: el usuario tiene que llegar a la página
  // de rotación dentro de /dashboard/actualizar-password (vive en este layout).
  // No redirigir a /revendedor acá porque haría loop con /revendedor/layout
  // que vuelve a redirigir a PASSWORD_ROTATION_PATH.
  if (mustChangePassword && (esEmpleado || session.user.userType === "platform_staff")) {
    return { session, permisos, esEmpleado }
  }

  if (isPlatformConsoleActor(session.user)) redirect(getPlatformConsoleHomePath(session.user))

  if (session.user.userType === "empresa" && !session.user.slug) redirect("/login?reason=session")
  if (esEmpleado && !session.user.empresa_id) redirect("/login?reason=session")

  // Gating de verificación de email: el registro público deja la empresa con
  // email_verificado=false hasta que ingrese el código de 6 dígitos (o entre con
  // Google, que lo auto-confirma). Va ANTES del gate de aprobación: primero
  // confirmás que sos dueño de la casilla, después te aprueban. No bloquea el login
  // (la sesión existe), solo el acceso al dashboard. Empleados NO se bloquean.
  if (session.user.userType === "empresa" && session.user.email_verificado === false) {
    const email = session.user.email
    redirect(email ? `/verificar-email?email=${encodeURIComponent(email)}` : "/verificar-email")
  }

  // Gating de aprobación: empresas registradas públicamente quedan "pendientes"
  // hasta que el superadmin las apruebe. No bloquea el login (la sesión existe),
  // pero sí el acceso al dashboard. Empleados NO se bloquean por esto.
  if (session.user.userType === "empresa" && session.user.aprobada === false) {
    redirect("/pendiente-aprobacion")
  }

  if (esEmpleado) {
    // A diferencia de los demás call sites de detección de revendedor, ACÁ
    // usamos solo esRolRevendedor(permisos) — NO el OR completo con
    // empleadoRol que trae isRevendedor() — a propósito: este es el guard
    // que bloquea TODO el dashboard, y un revendedor (rol="revendedor" en
    // DB) al que la empresa le agregó un permiso real extra (ej. escanear,
    // para hacer puerta en su propio evento) no debe quedar expulsado de
    // usar esa capacidad. El portal /revendedor sigue siendo accesible para
    // él igual, vía el guard de su propio layout (app/revendedor/layout.tsx),
    // que sí usa isRevendedor() con el criterio completo. No "corregir" esto
    // para que coincida con los demás call sites: es una divergencia
    // deliberada, no un bug de sincronización.
    const esRevendedor = esRolRevendedor(permisos)
    if (esRevendedor) redirect("/revendedor")

    const tieneAlgunAcceso = permisos && Object.values(permisos).some(Boolean)
    if (!tieneAlgunAcceso) redirect("/sin-acceso")
  }

  return { session, permisos, esEmpleado }
}

export async function requireDashboardHomeSession(): Promise<DashboardAuthContext> {
  const context = await requireDashboardSession()

  if (context.esEmpleado && !context.permisos?.ver_dashboard) {
    redirect(getDashboardFirstAccessiblePath({
      ...context,
      empleadoRol: context.session.user.empleadoRol ?? null,
    }))
  }

  return context
}
