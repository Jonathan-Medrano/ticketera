"use client"

import { useMemo } from "react"
import Link from "next/link"
import { ArrowRight, Eye, EyeOff, Loader2 } from "lucide-react"
import { normalizeTenantInfoPages, type TenantEmpresa } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import TenantImage from "./tenant-image"
import { TenantInput } from "./tenant-field"
import { PASSWORD_POLICY_HELPER_TEXT } from "@/lib/password-policy"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export type TenantLoginData = {
  email: string
  password: string
}

export type TenantRegisterData = {
  nombre: string
  apellido: string
  email: string
  dni: string
  password: string
  confirmar: string
}

type Palette = {
  primary: string
  background: string
  text: string
}

export function TenantAuthShell({
  tenant,
  palette,
  children,
}: {
  tenant: TenantEmpresa
  palette: Palette
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        minHeight: "100vh",
        background: palette.background,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        // El bottom-nav del tenant se oculta en /auth (ver shouldHideTenantBottomNav),
        // así que no hace falta reservarle clearance acá — evita scroll de más en pantallas altas.
        padding: `${TENANT_NAVBAR_CLEARANCE} 16px 40px`,
      }}
    >
      <div style={{ width: "100%", maxWidth: "360px" }}>
        <div style={{ textAlign: "center", marginBottom: "32px" }}>
          {tenant.logo_url ? (
            <TenantImage
              src={tenant.logo_url}
              alt={tenant.nombre}
              // Acá el logo es lo único que identifica a la marca en toda la
              // pantalla: h-12 (48px) lo dejaba perdido. Sube a h-20 (80px).
              className="h-20 w-auto object-contain mx-auto mb-4"
              width={384}
              height={160}
              sizes="(max-width: 400px) 240px, 384px"
              fallback={null}
            />
          ) : (
            <h1 style={{ color: palette.text, fontSize: "24px", fontWeight: 900, marginBottom: "4px" }}>{tenant.nombre}</h1>
          )}
          <p style={{ color: palette.text, opacity: 0.5, fontSize: "14px" }}>Ingresá o registrate para comprar y gestionar tus entradas</p>
        </div>
        {children}
      </div>
    </div>
  )
}

export function TenantAuthTabs({
  palette,
  tab,
  onChange,
}: {
  palette: Palette
  tab: "login" | "registro"
  onChange: (tab: "login" | "registro") => void
}) {
  return (
    <div
      style={{
        display: "flex",
        background: `${palette.text}15`,
        borderRadius: "16px",
        padding: "4px",
        marginBottom: "20px",
      }}
    >
      {[
        { key: "login", label: "Ingresar" },
        { key: "registro", label: "Registrarse" },
      ].map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onChange(item.key as "login" | "registro")}
          style={{
            flex: 1,
            padding: "14px 10px",
            borderRadius: "12px",
            fontSize: "14px",
            fontWeight: 600,
            border: "none",
            cursor: "pointer",
            background: tab === item.key ? palette.primary : "transparent",
            color: tab === item.key ? "#fff" : `${palette.text}80`,
            transition: "all 0.2s",
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

export function TenantAuthCard({
  palette,
  error,
  children,
}: {
  palette: Palette
  error: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        background: `${palette.text}08`,
        border: `1px solid ${palette.text}20`,
        borderRadius: "24px",
        padding: "24px",
        boxShadow: "0 10px 30px rgba(0,0,0,0.18)",
      }}
    >
      {error && (
        <div
          style={{
            background: "rgba(239,68,68,0.15)",
            border: "1px solid rgba(239,68,68,0.3)",
            color: "#f87171",
            fontSize: "14px",
            padding: "10px 16px",
            borderRadius: "12px",
            marginBottom: "12px",
          }}
        >
          {error}
        </div>
      )}
      {children}
    </div>
  )
}

export function TenantAuthLoginForm({
  tenant,
  palette,
  loginData,
  showPass,
  loading,
  onSubmit,
  onChange,
  onTogglePassword,
}: {
  tenant: TenantEmpresa
  palette: Palette
  loginData: TenantLoginData
  showPass: boolean
  loading: boolean
  onSubmit: (e: React.FormEvent) => void
  onChange: (next: TenantLoginData) => void
  onTogglePassword: () => void
}) {
  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <TenantInput
        tenant={tenant}
        id="tenant-login-email"
        name="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        placeholder="Email"
        value={loginData.email}
        onChange={(e) => onChange({ ...loginData, email: e.target.value })}
        required
        style={{ background: `${palette.text}12`, color: palette.text, borderColor: `${palette.text}20` }}
      />
      <div style={{ position: "relative" }}>
        <TenantInput
          tenant={tenant}
          id="tenant-login-password"
          name="password"
          type={showPass ? "text" : "password"}
          autoComplete="current-password"
          placeholder="Contraseña"
          value={loginData.password}
          onChange={(e) => onChange({ ...loginData, password: e.target.value })}
          required
          style={{ background: `${palette.text}12`, paddingRight: 44, color: palette.text, borderColor: `${palette.text}20` }}
        />
        <button
          type="button"
          onClick={onTogglePassword}
          aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={showPass}
          style={{ position: "absolute", right: "0px", top: "50%", transform: "translateY(-50%)", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: "8px", cursor: "pointer", color: palette.text, opacity: 0.4 }}
        >
          {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <button
        type="submit"
        disabled={loading}
        style={{ height: "44px", background: palette.primary, color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: loading ? 0.6 : 1 }}
      >
        {loading ? <><Loader2 size={16} className="animate-spin" /> Ingresando...</> : <>Ingresar <ArrowRight size={16} /></>}
      </button>
      <div style={{ textAlign: "center", marginTop: "4px" }}>
        <Link href={buildTenantPath(tenant.slug, tenantRoutes.authReset())} style={{ color: palette.text, opacity: 0.7, fontSize: "13px", textDecoration: "underline", display: "inline-block", paddingTop: "8px", paddingBottom: "8px" }}>
          Olvidé mi contraseña
        </Link>
      </div>
    </form>
  )
}

export function TenantAuthRegisterForm({
  tenant,
  palette,
  regData,
  showPass,
  showPass2,
  loading,
  onSubmit,
  onChange,
  onTogglePassword,
  onTogglePasswordConfirm,
}: {
  tenant: TenantEmpresa
  palette: Palette
  regData: TenantRegisterData
  showPass: boolean
  showPass2: boolean
  loading: boolean
  onSubmit: (e: React.FormEvent) => void
  onChange: (next: TenantRegisterData) => void
  onTogglePassword: () => void
  onTogglePasswordConfirm: () => void
}) {
  const passwordsMismatch = Boolean(regData.confirmar && regData.password !== regData.confirmar)

  // Mismo criterio que usa tenant-info-page para decidir si la pagina existe:
  // habilitada Y con contenido. Si la empresa no la cargo, no se ofrece el link.
  const tieneTerminos = useMemo(
    () => normalizeTenantInfoPages(tenant.info_pages)
      .some((p) => p.key === "terminos" && p.enabled && p.content.trim().length > 0),
    [tenant.info_pages],
  )

  return (
    <form onSubmit={onSubmit} style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <TenantInput tenant={tenant} id="tenant-register-nombre" name="nombre" autoComplete="given-name" placeholder="Nombre" value={regData.nombre} onChange={(e) => onChange({ ...regData, nombre: e.target.value })} required style={{ background: `${palette.text}12`, color: palette.text, borderColor: `${palette.text}20` }} />
        <TenantInput tenant={tenant} id="tenant-register-apellido" name="apellido" autoComplete="family-name" placeholder="Apellido" value={regData.apellido} onChange={(e) => onChange({ ...regData, apellido: e.target.value })} required style={{ background: `${palette.text}12`, color: palette.text, borderColor: `${palette.text}20` }} />
      </div>
      <TenantInput tenant={tenant} id="tenant-register-email" name="email" type="email" inputMode="email" autoComplete="email" placeholder="Email" value={regData.email} onChange={(e) => onChange({ ...regData, email: e.target.value })} required style={{ background: `${palette.text}12`, color: palette.text, borderColor: `${palette.text}20` }} />
      <TenantInput tenant={tenant} id="tenant-register-dni" name="dni" inputMode="numeric" autoComplete="off" placeholder="DNI" value={regData.dni} onChange={(e) => onChange({ ...regData, dni: e.target.value.replace(/\D/g, "") })} required maxLength={8} style={{ background: `${palette.text}12`, color: palette.text, borderColor: `${palette.text}20` }} />
      <div style={{ position: "relative" }}>
        <TenantInput tenant={tenant} id="tenant-register-password" name="password" type={showPass ? "text" : "password"} autoComplete="new-password" placeholder="Contraseña segura" value={regData.password} onChange={(e) => onChange({ ...regData, password: e.target.value })} required style={{ background: `${palette.text}12`, paddingRight: 44, color: palette.text, borderColor: `${palette.text}20` }} />
        <button type="button" onClick={onTogglePassword} aria-label={showPass ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPass} style={{ position: "absolute", right: "0px", top: "50%", transform: "translateY(-50%)", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: "8px", cursor: "pointer", color: palette.text, opacity: 0.4 }}>
          {showPass ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      <div style={{ position: "relative" }}>
        <TenantInput tenant={tenant} id="tenant-register-confirmar" name="confirmar" type={showPass2 ? "text" : "password"} autoComplete="new-password" placeholder="Confirmar contraseña" value={regData.confirmar} onChange={(e) => onChange({ ...regData, confirmar: e.target.value })} required style={{ background: `${palette.text}12`, paddingRight: 44, color: palette.text, borderColor: `${palette.text}20` }} />
        <button type="button" onClick={onTogglePasswordConfirm} aria-label={showPass2 ? "Ocultar contraseña" : "Mostrar contraseña"} aria-pressed={showPass2} style={{ position: "absolute", right: "0px", top: "50%", transform: "translateY(-50%)", width: "40px", height: "40px", display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", borderRadius: "8px", cursor: "pointer", color: palette.text, opacity: 0.4 }}>
          {showPass2 ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>

      {passwordsMismatch && <p style={{ color: "#f87171", fontSize: "12px" }}>Las contraseñas no coinciden</p>}
      <p style={{ color: palette.text, opacity: 0.6, fontSize: "12px", lineHeight: 1.4 }}>{PASSWORD_POLICY_HELPER_TEXT}</p>

      <button
        type="submit"
        disabled={loading || passwordsMismatch}
        style={{ height: "44px", background: palette.primary, color: "#fff", border: "none", borderRadius: "12px", fontWeight: 700, fontSize: "14px", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: "8px", opacity: loading ? 0.6 : 1 }}
      >
        {loading ? <><Loader2 size={16} className="animate-spin" /> Creando...</> : <>Crear cuenta <ArrowRight size={16} /></>}
      </button>

      {/* Solo se linkea si la empresa cargo los terminos. Si no, la pagina existe
          pero muestra "no disponible": mandar al comprador ahi desde el registro
          queda peor que no ofrecer el link. */}
      <p style={{ color: palette.text, opacity: 0.65, fontSize: "12px", textAlign: "center" }}>
        {tieneTerminos
          ? <>Al registrarte aceptás los <Link href={buildTenantPath(tenant.slug, tenantRoutes.terminos())} style={{ opacity: 0.7, textDecoration: "underline", color: palette.text }}>términos de uso</Link></>
          : <>Al registrarte aceptás los términos de uso</>}
      </p>
    </form>
  )
}
