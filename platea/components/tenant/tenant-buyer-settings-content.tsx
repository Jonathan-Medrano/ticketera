"use client"

import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CheckCircle2, KeyRound, MessageCircleMore, Smartphone } from "lucide-react"
import { toast } from "sonner"
import { useTenant } from "./tenant-provider"
import { formatDateTime } from "@/lib/format"
import { useTenantBuyerSession } from "./tenant-buyer-session-provider"
import { TenantInput } from "./tenant-field"
import { TenantCard, TenantPanel } from "./tenant-surface"
import { buildTenantApiPath } from "@/lib/tenant"
import { buildTenantPath, tenantRoutes } from "@/lib/tenant-routes"
import { validatePasswordPolicy } from "@/lib/password-policy"
import type { TenantEmpresa } from "@/lib/tenant"

import { TENANT_NAVBAR_CLEARANCE } from "@/lib/tenant-navbar-clearance"
export type BuyerDeliveryPreference = "email" | "whatsapp" | "both"

export type BuyerAccountSnapshot = {
  buyer: {
    email: string
    name: string
    phoneE164: string | null
    phoneVerifiedAt: string | null
    deliveryPreference: BuyerDeliveryPreference
  }
  whatsappVerification: {
    providerAvailable: boolean
  }
}

type MutationResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string }

type RequestCodePayload = {
  phoneE164: string
  expiresAt: string
  resendAvailableAt: string
}

type BuyerMutationPayload = {
  buyer: BuyerAccountSnapshot["buyer"]
}

type JsonResponseBody = { error?: string; data?: unknown } | null

async function readJson(response: Response) {
  return response.json().catch(() => null) as Promise<JsonResponseBody>
}

export async function submitBuyerPasswordChange(input: {
  tenantSlug: string
  currentPassword: string
  newPassword: string
  confirmPassword: string
  fetchImpl?: typeof fetch
}): Promise<MutationResult<{ ok: true }>> {
  const response = await (input.fetchImpl ?? fetch)(buildTenantApiPath(input.tenantSlug, "/account/password"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
      confirmPassword: input.confirmPassword,
    }),
  })

  const data = await readJson(response)
  if (!response.ok) return { ok: false, error: data?.error ?? "No pudimos actualizar la contraseña" }
  return { ok: true, data: { ok: true } }
}

export async function requestBuyerWhatsappCode(input: {
  tenantSlug: string
  phone: string
  fetchImpl?: typeof fetch
}): Promise<MutationResult<RequestCodePayload>> {
  const response = await (input.fetchImpl ?? fetch)(buildTenantApiPath(input.tenantSlug, "/account/whatsapp/request-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: input.phone }),
  })

  const data = await readJson(response)
  if (!response.ok) return { ok: false, error: data?.error ?? "No pudimos enviar el código" }
  return { ok: true, data: data?.data as RequestCodePayload }
}

export async function verifyBuyerWhatsappCode(input: {
  tenantSlug: string
  phone: string
  code: string
  fetchImpl?: typeof fetch
}): Promise<MutationResult<BuyerMutationPayload>> {
  const response = await (input.fetchImpl ?? fetch)(buildTenantApiPath(input.tenantSlug, "/account/whatsapp/verify-code"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone: input.phone, code: input.code }),
  })

  const data = await readJson(response)
  if (!response.ok) return { ok: false, error: data?.error ?? "No pudimos verificar el código" }
  return { ok: true, data: data?.data as BuyerMutationPayload }
}

export async function saveBuyerDeliveryPreference(input: {
  tenantSlug: string
  deliveryPreference: BuyerDeliveryPreference
  fetchImpl?: typeof fetch
}): Promise<MutationResult<BuyerMutationPayload>> {
  const response = await (input.fetchImpl ?? fetch)(buildTenantApiPath(input.tenantSlug, "/account/delivery-preference"), {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ deliveryPreference: input.deliveryPreference }),
  })

  const data = await readJson(response)
  if (!response.ok) return { ok: false, error: data?.error ?? "No pudimos guardar la preferencia" }
  return { ok: true, data: data?.data as BuyerMutationPayload }
}

export function canUseWhatsappDelivery(phoneVerifiedAt: string | null) {
  return Boolean(phoneVerifiedAt)
}

export function getBuyerDeliveryOptions(providerAvailable: boolean) {
  return [
    { value: "email" as const, label: "Email", enabled: true },
    { value: "whatsapp" as const, label: "WhatsApp", enabled: providerAvailable },
    { value: "both" as const, label: "Email + WhatsApp", enabled: providerAvailable },
  ]
}

const SHOW_WHATSAPP_DELIVERY_SETTINGS = false

export function TenantBuyerSettingsView({
  tenant,
  snapshot,
  passwordForm,
  passwordLoading,
  passwordError,
  phone,
  code,
  phoneLoading,
  phoneError,
  phoneSuccess,
  deliveryPreference,
  deliveryLoading,
  deliveryError,
  onPasswordChange,
  onPhoneChange,
  onCodeChange,
  onDeliveryPreferenceChange,
  onPasswordSubmit,
  onRequestCode,
  onVerifyCode,
  onSaveDeliveryPreference,
}: {
  tenant: TenantEmpresa
  snapshot: BuyerAccountSnapshot
  passwordForm: { currentPassword: string; newPassword: string; confirmPassword: string }
  passwordLoading: boolean
  passwordError: string
  phone: string
  code: string
  phoneLoading: boolean
  phoneError: string
  phoneSuccess: string
  deliveryPreference: BuyerDeliveryPreference
  deliveryLoading: boolean
  deliveryError: string
  onPasswordChange: (next: { currentPassword: string; newPassword: string; confirmPassword: string }) => void
  onPhoneChange: (next: string) => void
  onCodeChange: (next: string) => void
  onDeliveryPreferenceChange: (next: BuyerDeliveryPreference) => void
  onPasswordSubmit: (event: React.FormEvent) => void
  onRequestCode: (event: React.FormEvent) => void
  onVerifyCode: (event: React.FormEvent) => void
  onSaveDeliveryPreference: (event: React.FormEvent) => void
}) {
  const whatsappReady = canUseWhatsappDelivery(snapshot.buyer.phoneVerifiedAt)
  const deliveryOptions = getBuyerDeliveryOptions(snapshot.whatsappVerification.providerAvailable)

  return (
    <div className="min-h-screen pb-28" style={{ background: tenant.color_fondo, color: tenant.color_texto }}>
      <div className="mx-auto max-w-3xl px-4 space-y-6" style={{ paddingTop: TENANT_NAVBAR_CLEARANCE }}>
        <TenantPanel tenant={tenant} className="rounded-[2rem] border p-5 md:p-6">
          <div className="inline-flex rounded-full px-3 py-1 text-[11px] font-semibold" style={{ background: `${tenant.color_primario}18`, color: tenant.color_primario }}>
            Cuenta del comprador
          </div>
          <h1 className="mt-4 text-3xl font-black tracking-[-0.04em]">Configuraciones</h1>
          <p className="mt-3 text-sm leading-relaxed" style={{ color: `${tenant.color_texto}bf` }}>
            Gestioná tu contraseña y los datos principales de tu cuenta.
          </p>
          <div className={`mt-4 grid gap-3 ${SHOW_WHATSAPP_DELIVERY_SETTINGS ? "md:grid-cols-2" : "md:grid-cols-1"}`}>
            <TenantCard tenant={tenant} className="rounded-2xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: `${tenant.color_texto}66` }}>Cuenta</p>
              <p className="mt-2 font-semibold">{snapshot.buyer.name}</p>
              <p className="text-sm" style={{ color: `${tenant.color_texto}bf` }}>{snapshot.buyer.email}</p>
            </TenantCard>
            {SHOW_WHATSAPP_DELIVERY_SETTINGS ? <TenantCard tenant={tenant} className="rounded-2xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: `${tenant.color_texto}66` }}>Entrega actual</p>
              <p className="mt-2 font-semibold">{deliveryOptions.find((option) => option.value === snapshot.buyer.deliveryPreference)?.label ?? "Email"}</p>
              <p className="text-sm" style={{ color: `${tenant.color_texto}bf` }}>{whatsappReady ? "Tu WhatsApp está verificado." : "WhatsApp todavía no está verificado."}</p>
            </TenantCard> : null}
          </div>
        </TenantPanel>

        <TenantPanel tenant={tenant} className="rounded-[2rem] border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <KeyRound className="h-5 w-5" style={{ color: tenant.color_primario }} />
            <div>
              <h2 className="font-bold">Cambiar contraseña</h2>
              <p className="text-sm" style={{ color: `${tenant.color_texto}bf` }}>Después de guardarla te vamos a pedir volver a ingresar.</p>
            </div>
          </div>
          <form className="mt-5 space-y-3" onSubmit={onPasswordSubmit}>
            {passwordError ? <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{passwordError}</div> : null}
            <label className="block space-y-2 text-sm font-medium">
              <span>Contraseña actual</span>
              <TenantInput tenant={tenant} id="buyer-current-password" name="current-password" type="password" autoComplete="current-password" value={passwordForm.currentPassword} onChange={(event) => onPasswordChange({ ...passwordForm, currentPassword: event.target.value })} required />
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="block space-y-2 text-sm font-medium">
                <span>Nueva contraseña</span>
                <TenantInput tenant={tenant} id="buyer-new-password" name="new-password" type="password" autoComplete="new-password" value={passwordForm.newPassword} onChange={(event) => onPasswordChange({ ...passwordForm, newPassword: event.target.value })} required />
              </label>
              <label className="block space-y-2 text-sm font-medium">
                <span>Confirmar nueva contraseña</span>
                <TenantInput tenant={tenant} id="buyer-confirm-password" name="confirmar" type="password" autoComplete="new-password" value={passwordForm.confirmPassword} onChange={(event) => onPasswordChange({ ...passwordForm, confirmPassword: event.target.value })} required />
              </label>
            </div>
            <button type="submit" disabled={passwordLoading} className="w-full h-11 rounded-xl px-5 font-bold text-white disabled:opacity-60" style={{ background: tenant.color_primario }}>
              {passwordLoading ? "Guardando..." : "Actualizar contraseña"}
            </button>
          </form>
        </TenantPanel>

        {SHOW_WHATSAPP_DELIVERY_SETTINGS ? (
        <TenantPanel tenant={tenant} className="rounded-[2rem] border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <MessageCircleMore className="h-5 w-5" style={{ color: tenant.color_primario }} />
            <div>
              <h2 className="font-bold">WhatsApp para entregas</h2>
              <p className="text-sm" style={{ color: `${tenant.color_texto}bf` }}>
                {snapshot.whatsappVerification.providerAvailable
                  ? "Pedí un código, verificá tu número y habilitá entregas por WhatsApp."
                  : "WhatsApp todavía no está disponible para este tenant."}
              </p>
            </div>
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-2">
            <TenantCard tenant={tenant} className="rounded-2xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: `${tenant.color_texto}66` }}>Número vinculado</p>
              <p className="mt-2 font-semibold">{snapshot.buyer.phoneE164 ?? "Todavía no vinculaste un número"}</p>
              <p className="mt-1 text-sm" style={{ color: whatsappReady ? "#4ade80" : `${tenant.color_texto}bf` }}>
                {whatsappReady ? `Verificado el ${formatDateTime(snapshot.buyer.phoneVerifiedAt as string)}` : "Necesita verificación para usar entregas por WhatsApp."}
              </p>
            </TenantCard>
            <TenantCard tenant={tenant} className="rounded-2xl border p-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em]" style={{ color: `${tenant.color_texto}66` }}>Estado</p>
              <div className="mt-2 inline-flex items-center gap-2 rounded-full px-3 py-1 text-sm font-medium" style={{ background: whatsappReady ? "rgba(34,197,94,0.16)" : `${tenant.color_texto}10`, color: whatsappReady ? "#4ade80" : tenant.color_texto }}>
                <CheckCircle2 className="h-4 w-4" /> {whatsappReady ? "Verificado" : "Pendiente"}
              </div>
            </TenantCard>
          </div>
          {phoneError ? <div role="alert" className="mt-4 rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{phoneError}</div> : null}
          {phoneSuccess ? <div className="mt-4 rounded-xl border border-green-400/30 bg-green-500/10 px-4 py-3 text-sm text-green-300">{phoneSuccess}</div> : null}
          {snapshot.whatsappVerification.providerAvailable ? (
            <div className="mt-5 grid gap-5 lg:grid-cols-2">
              <form className="space-y-3" onSubmit={onRequestCode}>
                <label className="block space-y-2 text-sm font-medium">
                  <span>Tu WhatsApp</span>
                  <TenantInput tenant={tenant} id="buyer-phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(event) => onPhoneChange(event.target.value)} placeholder="+54 9 11 5555 4444" required />
                </label>
                <button type="submit" disabled={phoneLoading} className="h-11 rounded-xl px-5 font-bold text-white disabled:opacity-60" style={{ background: tenant.color_primario }}>
                  {phoneLoading ? "Enviando..." : "Enviar código"}
                </button>
              </form>
              <form className="space-y-3" onSubmit={onVerifyCode}>
                <label className="block space-y-2 text-sm font-medium">
                  <span>Código de verificación</span>
                  <TenantInput tenant={tenant} id="buyer-otp-code" name="otp-code" inputMode="numeric" autoComplete="one-time-code" value={code} onChange={(event) => onCodeChange(event.target.value)} placeholder="123456" required />
                </label>
                <button type="submit" disabled={phoneLoading || phone.trim().length === 0} className="h-11 rounded-xl px-5 font-bold text-white disabled:opacity-60" style={{ background: tenant.color_primario }}>
                  {phoneLoading ? "Verificando..." : "Verificar código"}
                </button>
              </form>
            </div>
          ) : null}
        </TenantPanel>
        ) : null}

        {SHOW_WHATSAPP_DELIVERY_SETTINGS ? (
        <TenantPanel tenant={tenant} className="rounded-[2rem] border p-5 md:p-6">
          <div className="flex items-center gap-3">
            <Smartphone className="h-5 w-5" style={{ color: tenant.color_primario }} />
            <div>
              <h2 className="font-bold">Preferencia de entrega</h2>
              <p className="text-sm" style={{ color: `${tenant.color_texto}bf` }}>Elegí por qué canal querés recibir tus tickets y consumibles.</p>
            </div>
          </div>
          <form className="mt-5 space-y-4" onSubmit={onSaveDeliveryPreference}>
            {deliveryError ? <div role="alert" className="rounded-xl border border-red-400/30 bg-red-500/10 px-4 py-3 text-sm text-red-300">{deliveryError}</div> : null}
            <div className="grid gap-3 md:grid-cols-3">
              {deliveryOptions.map((option) => (
                <label key={option.value} className="block cursor-pointer">
                  <input type="radio" name="delivery-preference" value={option.value} checked={deliveryPreference === option.value} disabled={!option.enabled || deliveryLoading} onChange={() => onDeliveryPreferenceChange(option.value)} className="sr-only" />
                  <TenantCard tenant={tenant} className="rounded-2xl border p-4 h-full" style={{ borderColor: deliveryPreference === option.value ? tenant.color_primario : undefined, background: deliveryPreference === option.value ? `${tenant.color_primario}12` : undefined, opacity: option.enabled ? 1 : 0.55 }}>
                    <p className="font-semibold">{option.label}</p>
                    <p className="mt-2 text-sm" style={{ color: `${tenant.color_texto}bf` }}>
                      {option.value === "email" ? "Siempre disponible." : option.enabled ? "Necesita WhatsApp verificado." : "Disponible cuando el tenant habilite WhatsApp."}
                    </p>
                  </TenantCard>
                </label>
              ))}
            </div>
            {!whatsappReady && deliveryPreference !== "email" ? (
              <p className="text-sm text-muted-foreground">Primero verificá tu WhatsApp para guardar esta preferencia.</p>
            ) : null}
            <button type="submit" disabled={deliveryLoading || (!whatsappReady && deliveryPreference !== "email")} className="h-11 rounded-xl px-5 font-bold text-white disabled:opacity-60" style={{ background: tenant.color_primario }}>
              {deliveryLoading ? "Guardando..." : "Guardar preferencia"}
            </button>
          </form>
        </TenantPanel>
        ) : null}
      </div>
    </div>
  )
}

export default function TenantBuyerSettingsContent({ initialSnapshot }: { initialSnapshot: BuyerAccountSnapshot }) {
  const tenant = useTenant()
  const router = useRouter()
  const { logout } = useTenantBuyerSession()
  const [snapshot, setSnapshot] = useState(initialSnapshot)
  const [passwordForm, setPasswordForm] = useState({ currentPassword: "", newPassword: "", confirmPassword: "" })
  const [passwordLoading, setPasswordLoading] = useState(false)
  const [passwordError, setPasswordError] = useState("")
  const [phone, setPhone] = useState(initialSnapshot.buyer.phoneE164 ?? "")
  const [code, setCode] = useState("")
  const [phoneLoading, setPhoneLoading] = useState(false)
  const [phoneError, setPhoneError] = useState("")
  const [phoneSuccess, setPhoneSuccess] = useState("")
  const [deliveryPreference, setDeliveryPreference] = useState<BuyerDeliveryPreference>(initialSnapshot.buyer.deliveryPreference)
  const [deliveryLoading, setDeliveryLoading] = useState(false)
  const [deliveryError, setDeliveryError] = useState("")

  const trimmedPhone = useMemo(() => phone.trim(), [phone])

  async function handlePasswordSubmit(event: React.FormEvent) {
    event.preventDefault()
    setPasswordError("")

    const validationError = validatePasswordPolicy(passwordForm.newPassword)
    if (validationError) {
      setPasswordError(validationError)
      return
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      setPasswordError("Las contraseñas no coinciden")
      return
    }

    setPasswordLoading(true)
    const result = await submitBuyerPasswordChange({ tenantSlug: tenant.slug, ...passwordForm })
    setPasswordLoading(false)

    if (!result.ok) {
      setPasswordError(result.error)
      return
    }

    toast.success("Contraseña actualizada. Volvé a ingresar con tu nueva clave.")
    await logout()
    router.push(buildTenantPath(tenant.slug, tenantRoutes.auth(tenantRoutes.configuracion())))
    router.refresh()
  }

  async function handleRequestCode(event: React.FormEvent) {
    event.preventDefault()
    setPhoneError("")
    setPhoneSuccess("")
    setPhoneLoading(true)
    const result = await requestBuyerWhatsappCode({ tenantSlug: tenant.slug, phone: trimmedPhone })
    setPhoneLoading(false)

    if (!result.ok) {
      setPhoneError(result.error)
      return
    }

    setPhone(result.data.phoneE164)
    setCode("")
    setSnapshot((current) => ({
      ...current,
      buyer: {
        ...current.buyer,
        phoneE164: result.data.phoneE164,
        phoneVerifiedAt: null,
      },
    }))
    setPhoneSuccess("Te enviamos un código por WhatsApp. Ingresalo para terminar la vinculación.")
  }

  async function handleVerifyCode(event: React.FormEvent) {
    event.preventDefault()
    setPhoneError("")
    setPhoneSuccess("")
    setPhoneLoading(true)
    const result = await verifyBuyerWhatsappCode({ tenantSlug: tenant.slug, phone: trimmedPhone, code: code.trim() })
    setPhoneLoading(false)

    if (!result.ok) {
      setPhoneError(result.error)
      return
    }

    setSnapshot((current) => ({ ...current, buyer: result.data.buyer }))
    setPhone(result.data.buyer.phoneE164 ?? trimmedPhone)
    setPhoneSuccess("WhatsApp verificado correctamente.")
    toast.success("WhatsApp verificado")
  }

  async function handleSaveDeliveryPreference(event: React.FormEvent) {
    event.preventDefault()
    setDeliveryError("")
    setDeliveryLoading(true)
    const result = await saveBuyerDeliveryPreference({ tenantSlug: tenant.slug, deliveryPreference })
    setDeliveryLoading(false)

    if (!result.ok) {
      setDeliveryError(result.error)
      return
    }

    setSnapshot((current) => ({ ...current, buyer: result.data.buyer }))
    setDeliveryPreference(result.data.buyer.deliveryPreference)
    toast.success("Preferencia guardada")
  }

  return (
    <TenantBuyerSettingsView
      tenant={tenant}
      snapshot={snapshot}
      passwordForm={passwordForm}
      passwordLoading={passwordLoading}
      passwordError={passwordError}
      phone={phone}
      code={code}
      phoneLoading={phoneLoading}
      phoneError={phoneError}
      phoneSuccess={phoneSuccess}
      deliveryPreference={deliveryPreference}
      deliveryLoading={deliveryLoading}
      deliveryError={deliveryError}
      onPasswordChange={setPasswordForm}
      onPhoneChange={setPhone}
      onCodeChange={setCode}
      onDeliveryPreferenceChange={setDeliveryPreference}
      onPasswordSubmit={handlePasswordSubmit}
      onRequestCode={handleRequestCode}
      onVerifyCode={handleVerifyCode}
      onSaveDeliveryPreference={handleSaveDeliveryPreference}
    />
  )
}
