# Features — Auth / Onboarding (registro, verificación, login, roles)
**Rol:** fuente de verdad · **Última actualización:** 2026-06-23

## Qué es esta zona
Todo el ciclo de identidad de TICKETERA: registro de empresa, verificación de email (código + magic-link), gates de aprobación/verificación, los 4 tipos de usuario con sus flujos de login separados, RBAC de empleados, login con Google y recuperación de contraseña. El backend interno exige `x-internal-secret` (`verifyInternal`, `backend/src/middleware/auth.ts:34`); el frontend orquesta sesiones internas con **NextAuth (JWT)** (`platea/auth.ts`) y la sesión de comprador con un provider propio cookie-based (`platea/components/tenant/tenant-buyer-session-provider.tsx`).

> **Dos sistemas de sesión distintos:** NextAuth maneja `empresa`/`empleado`/`super_admin`/`platform_staff` + impersonation. El **comprador NO es un provider de NextAuth** (en `auth.ts:459` su token se descarta): su sesión vive aparte, tenant-scoped, vía `requestBuyerSession` (modos `password` y `token`).

## Features

| Feature | Estado | Archivos clave | Notas / deuda |
|---|---|---|---|
| **4 tipos de usuario** (`empresa`, `empleado`, `comprador`, `super_admin` + `platform_staff`) | ✅ | `backend/src/lib/authz.ts:31-171` (`rehydrateSessionUser`); `platea/lib/auth-identities.ts` | Cada uno con login propio. `platform_staff` es un quinto tipo derivado (admin de plataforma no-singleton). |
| **Registro público de empresa** | ✅ | `backend/src/routes/auth.ts:20-106` (`POST /auth/registro`); BFF `platea/app/api/auth/registro/route.ts` | Valida email único (`assertInternalEmailAvailable`), slug único (`assertTenantSlugAvailable`) y password policy. Hash bcrypt cost 12. Arranca `email_verificado=false`. |
| **Gate de aprobación de empresa** (`aprobada`) | ✅ | `auth.ts:42-68` (setea `aprobada` según flag auto-aprobar); `platea/lib/dashboard-auth.ts:55-57` (→ `/pendiente-aprobacion`) | Registro libre, pero el dashboard queda gateado hasta que el superadmin apruebe. Si auto-aprobación está ON, queda `aprobada=true` + email de bienvenida. Ver `super-admin.md`. |
| **Verificación de email — código 6 dígitos** | ✅ | `backend/src/lib/email-verification.ts:100-241`; `POST /auth/verify-email` (`auth.ts:155-184`); UI `platea/app/(marketing)/verificar-email/` | Código hasheado SHA-256, 1 activo por empresa (borra previos no consumidos). Máx **5 intentos** por código. Idempotente si ya verificada. |
| **Verificación de email — magic-link 1 click** | ✅ | `email-verification.ts:254-309` (`confirmEmailByLinkToken`); `POST /auth/verify-email/confirm` (`auth.ts:188-206`); autoconfirm en `verificar-email-form.tsx:87-129` | Token de 32 bytes, un solo uso, autoconfirma al montar (POST sólo desde JS → un escáner de mails no lo dispara). Pantalla final compartida con el flujo de código. Idempotente. |
| **TTL de verificación configurable por env** | ✅ | `email-verification.ts:22-23` (`EMAIL_VERIFICATION_TTL_SECONDS`, default **600s**) | Aplica al código Y al magic-link (mismo registro). Override para testear expiración rápido; al quitarlo vuelve solo a 10 min. |
| **Reenvío de código de verificación** | ✅ | `POST /auth/verify-email/resend` (`auth.ts:210-239`); UI cooldown 30s | **Siempre responde 200** (no filtra si el email existe). Sólo reenvía si la empresa existe y no está verificada. |
| **Gate de verificación en dashboard** | ✅ | `dashboard-auth.ts:47-50` (→ `/verificar-email`); `authz.ts:40` (rehydrate rechaza si `!email_verificado`) | Va ANTES del gate de aprobación. NO bloquea el login (la sesión existe), sólo el dashboard. Empleados NO se bloquean. |
| **Login empresa (credenciales)** | ✅ | `platea/auth.ts:174-190` (provider `credentials-empresa`); `auth-identities.ts:48-132` (`resolveCompanyOrSuperAdminLogin`) | Acepta **email O slug** como identificador (ambos únicos). Rate-limit in-process 5/15min por IP (`auth.ts:33-45`). |
| **Login super_admin / platform_staff** (mismo provider) | ✅ | `auth-identities.ts:52-90` (chequea platform admin ANTES que empresa) | Resuelve `super_admin` (singleton) vs `platform_staff` por `role_slug`+`singleton_key`. |
| **Login empleado (credenciales + RBAC)** | ✅ | `auth.ts:191-252` (provider `credentials-empleado`) | JOIN raw usuarios+empresas+roles. Resuelve permisos: `usuario.permisos` → `rol.permisos` → `ROLES_PREDEFINIDOS`. Refresca permisos en cada `jwt()` callback (`auth.ts:375-420`). |
| **Login con Google (empresa)** | ✅ | `auth.ts:291-347` (callback `signIn`); `platea/lib/google-auth.ts` | **Exige `profile.email_verified===true`** o corta el sign-in. Si la empresa existe y no estaba verificada, la **auto-confirma** en DB (`auth.ts:331-336`). Si no existe → redirect a onboarding. |
| **RBAC empleados — roles predefinidos** (`puerta`, `vendedor`, `operador`, `admin`, `revendedor`, `barra`) | ✅ | `platea/lib/permisos.ts:136-212` (`ROLES_PREDEFINIDOS`) | Catálogo fijo de permisos por rol. `revendedor` NO es un `userType`: es un empleado detectado por permisos/`empleadoRol` (`dashboard-auth.ts:62`, `esRolRevendedor`). |
| **RBAC — permisos custom por usuario / rol** | ✅ | tablas `usuarios.permisos`, `roles.permisos`; chequeos en `authz.ts:179-202` (`requirePermission`/`requireAnyPermission`) | `usuario.permisos` (override directo) tiene prioridad sobre `rol.permisos`. Empresa/comprador no se filtran por permiso (sólo empleados). |
| **RBAC plataforma — capabilities** | ✅ | `authz.ts:208-267`; `backend/src/lib/platform-governance.ts` | Catálogo de 11 capabilities `platform.*`. Singleton superadmin tiene todas implícitas. Ver `super-admin.md`. |
| **Password reset (empresa / empleado / comprador)** | ✅ | `backend/src/lib/password-reset.ts`; `POST /auth/password/forgot` + `/reset` (`auth.ts:108-152`); comprador vía `tenant.ts:1735-1796` | Token 32 bytes hasheado, TTL **15 min**, un solo uso. **Siempre 200** en forgot (anti-enumeración). Consumo con `FOR UPDATE` en `prismaDirectUrl` (anti doble-uso). Invalida tokens previos al reemitir. |
| **Must-change-password (rotación forzada)** | ✅ | `auth.config.ts:53-58`; `dashboard-auth.ts:33-35`; `platea/lib/password-rotation.ts` | Empleado/platform_staff con `must_change_password=true` se fuerzan a `PASSWORD_ROTATION_PATH` antes de cualquier dashboard. |
| **Password version (invalidación de sesiones)** | ✅ | `platea/lib/password-version.ts`; chequeos en `auth.ts:402,446,475` | Si cambia el password, las sesiones JWT viejas se invalidan (token devuelve `{}`). Aplica a empresa, empleado y platform admin. |
| **Registro de comprador (tenant)** | ✅ | `backend/src/routes/tenant.ts:1634+` (`POST /:slug/registro`); UI `platea/components/tenant/tenant-auth.tsx` | Valida nombre/apellido/email/dni/teléfono + password policy. Soporta `ref_codigo` (revendedor). |
| **Login comprador (password)** | ✅ | provider propio cookie-based: `tenant-buyer-session-provider.tsx` (modo `password` vía `requestBuyerSession`) | Sesión tenant-scoped, separada de NextAuth. |
| **Login comprador (magic token)** | ✅ | `tenant-buyer-session-provider.tsx:57-62` (`loginWithToken`, modo `token`); UI `tenant-token-login.tsx` | El GET `/:slug/auth/token` legacy está **deshabilitado (410)** (`tenant.ts:1726-1732`): el consumo del token mágico ahora vive sólo en el provider server-side para evitar side-effects por GET y fuga de PII. |
| **Verificación de WhatsApp del comprador** | ✅ | `tenant.ts:1845-1908` (`request-code` / `verify-code`, rate-limited) | Código a WhatsApp para confirmar el teléfono de la cuenta del comprador. |
| **Impersonar empresa (super-admin "login as")** | ✅ (bug previo **resuelto**) | provider `credentials-impersonation` (`auth.ts:253-288`); guard TTL en `auth.ts:367-372,422-431` | Token efímero un-solo-uso (`PlatformImpersonationToken`). Cap absoluto **30 min** desde el sign-in vía `impersonatedAt` (sellado UNA vez, NO usa `token.iat`). El bug histórico (`token.iat` undefined rebotaba a `/login`) está corregido: ahora se sella `impersonatedAt` en el sign-in. ⚠️ `super-admin.md:24` todavía lo lista como bug abierto — desactualizado. |

## Lo que NO hay (anti-alucinación)
- **NO hay verificación de email para empleados ni compradores** — el flujo código/magic-link es **sólo para empresas** (`email_verificado` vive en `Empresa`).
- **NO hay provider de NextAuth para comprador** — su token se descarta en `auth.ts:459`; usa sesión cookie-based aparte.
- **NO hay login con Google para empleados ni compradores** — Google es sólo para empresas (`auth.ts:292`).
- **NO hay registro público de empleados** — los empleados los crea la empresa desde el dashboard (equipo/roles).
- **NO hay registro público de super_admin / platform_staff** — el superadmin se bootstrapea por seed (`npm run prisma:seed`, `SUPERADMIN_*`); el staff lo crea el superadmin.
- **NO hay MFA/2FA real** para login (sólo verificación de email en registro y WhatsApp del comprador).
- **El rate-limit de login del frontend es in-process (Map por instancia)** — en multi-instancia un atacante multiplica el cap por N (documentado en `auth.ts:27-32`). No es un store compartido (Redis).
- **NO hay "revendedor" como `userType`** — es un empleado detectado por permisos/`empleadoRol`.
- **El GET `/:slug/auth/token` está muerto (410)** — no consumir el token mágico por GET.

## Ver también
- [`../FEATURES.md`](../FEATURES.md) — índice general de features
- [`super-admin.md`](super-admin.md) — aprobación de empresas, auto-aprobación, impersonation, capabilities de plataforma
- [`revendedores.md`](revendedores.md) — el revendedor como empleado por permisos
- [`../auth.txt`](../auth.txt) — guía de dominio de auth (flujos, providers, modelo de permisos)
- [`../playbook-login.md`](../playbook-login.md) — triage de incidentes de login
- [`../playbook-permisos-y-accesos.md`](../playbook-permisos-y-accesos.md) — triage de permisos/accesos
