import assert from "node:assert/strict"
import { createRequire } from "node:module"
import Module from "node:module"
import test from "node:test"
import React from "react"
import type { ReactElement } from "react"
import type { ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import {
  TenantBuyerSettingsView,
  canUseWhatsappDelivery,
  getBuyerDeliveryOptions,
  requestBuyerWhatsappCode,
  saveBuyerDeliveryPreference,
  submitBuyerPasswordChange,
  verifyBuyerWhatsappCode,
  type BuyerAccountSnapshot,
} from "./tenant-buyer-settings-content"
import { buildTenantInfoMenuSections } from "./tenant-info-menu"
import { buildBuyerDeliveryDispatchPlan } from "../../../backend/src/lib/buyer-delivery-dispatcher"
import type { TenantEmpresa } from "@/lib/tenant"

const require = createRequire(import.meta.url)
type NodeModuleLoader = typeof Module & {
  _load: (request: string, parent: NodeModule | null, isMain: boolean) => unknown
}

const snapshotBase: BuyerAccountSnapshot = {
  buyer: {
    email: "buyer@example.com",
    name: "Comprador Demo",
    phoneE164: null,
    phoneVerifiedAt: null,
    deliveryPreference: "email",
  },
  whatsappVerification: {
    providerAvailable: true,
  },
}

const tenantBase: TenantEmpresa = {
  id: "tenant-1",
  nombre: "Club Demo",
  slug: "club-demo",
  logo_url: null,
  color_primario: "#7c3aed",
  color_fondo: "#111827",
  color_texto: "#ffffff",
  descripcion: null,
  whatsapp: null,
}

function renderView(snapshot = snapshotBase) {
  return renderToStaticMarkup(
    <TenantBuyerSettingsView
      tenant={tenantBase}
      snapshot={snapshot}
      passwordForm={{ currentPassword: "", newPassword: "", confirmPassword: "" }}
      passwordLoading={false}
      passwordError=""
      phone={snapshot.buyer.phoneE164 ?? ""}
      code=""
      phoneLoading={false}
      phoneError=""
      phoneSuccess=""
      deliveryPreference={snapshot.buyer.deliveryPreference}
      deliveryLoading={false}
      deliveryError=""
      onPasswordChange={() => undefined}
      onPhoneChange={() => undefined}
      onCodeChange={() => undefined}
      onDeliveryPreferenceChange={() => undefined}
      onPasswordSubmit={() => undefined}
      onRequestCode={() => undefined}
      onVerifyCode={() => undefined}
      onSaveDeliveryPreference={() => undefined}
    />
  )
}

test("buyer settings view renders password section and hides whatsapp/delivery sections", () => {
  const markup = renderView()

  assert.match(markup, />Configuraciones</)
  assert.match(markup, />Cambiar contraseña</)
  assert.doesNotMatch(markup, />WhatsApp para entregas</)
  assert.doesNotMatch(markup, />Preferencia de entrega</)
})

test("buyer settings view keeps whatsapp/delivery copy hidden when the feature is off", () => {
  const markup = renderView({
    ...snapshotBase,
    whatsappVerification: { providerAvailable: false },
  })

  assert.doesNotMatch(markup, />Enviar código</)
  assert.doesNotMatch(markup, /WhatsApp para entregas/i)
  assert.doesNotMatch(markup, /Preferencia de entrega/i)
})

test("buyer settings helpers expose whatsapp-ready and delivery option states", () => {
  assert.equal(canUseWhatsappDelivery(null), false)
  assert.equal(canUseWhatsappDelivery("2026-05-18T12:00:00.000Z"), true)
  assert.equal(getBuyerDeliveryOptions(false).find((option) => option.value === "whatsapp")?.enabled, false)
  assert.equal(getBuyerDeliveryOptions(true).find((option) => option.value === "both")?.enabled, true)
})

test("buyer settings mutation helpers normalize backend success and error responses", async () => {
  const okFetch: typeof fetch = async () => new Response(JSON.stringify({ data: { phoneE164: "+5491155554444", expiresAt: "2026-05-18T10:05:00.000Z", resendAvailableAt: "2026-05-18T10:02:00.000Z", buyer: { ...snapshotBase.buyer, phoneE164: "+5491155554444", phoneVerifiedAt: "2026-05-18T10:01:00.000Z", deliveryPreference: "both" } }, ok: true }), { status: 200 })
  const errorFetch: typeof fetch = async () => new Response(JSON.stringify({ error: "falló" }), { status: 400 })

  const passwordOk = await submitBuyerPasswordChange({ tenantSlug: "club-demo", currentPassword: "a", newPassword: "b", confirmPassword: "b", fetchImpl: okFetch })
  const requestError = await requestBuyerWhatsappCode({ tenantSlug: "club-demo", phone: "+549", fetchImpl: errorFetch })
  const verifyOk = await verifyBuyerWhatsappCode({ tenantSlug: "club-demo", phone: "+549", code: "123456", fetchImpl: okFetch })
  const preferenceOk = await saveBuyerDeliveryPreference({ tenantSlug: "club-demo", deliveryPreference: "both", fetchImpl: okFetch })

  assert.equal(passwordOk.ok, true)
  assert.deepEqual(requestError, { ok: false, error: "falló" })
  assert.equal(verifyOk.ok, true)
  assert.equal(verifyOk.ok && verifyOk.data.buyer.phoneE164, "+5491155554444")
  assert.equal(preferenceOk.ok, true)
  assert.equal(preferenceOk.ok && preferenceOk.data.buyer.deliveryPreference, "both")
})

test("buyer delivery preference helper preserves unverified-whatsapp backend rejection", async () => {
  const errorFetch: typeof fetch = async () => new Response(JSON.stringify({ error: "Necesitás verificar tu WhatsApp antes de elegir esta opción" }), { status: 400 })

  const preferenceError = await saveBuyerDeliveryPreference({ tenantSlug: "club-demo", deliveryPreference: "whatsapp", fetchImpl: errorFetch })

  assert.deepEqual(preferenceError, {
    ok: false,
    error: "Necesitás verificar tu WhatsApp antes de elegir esta opción",
  })
})

type MockHandler = (arg?: unknown) => unknown
type MockProps = {
  children?: ReactNode | RenderedNode | Array<RenderedNode>
  onChange: MockHandler
  onSubmit: MockHandler
  disabled?: boolean
  [key: string]: unknown
}

type RenderedNode =
  | string
  | number
  | boolean
  | null
  | undefined
  | { type: unknown; props: MockProps }

class RedirectError extends Error {
  constructor(readonly location: string) {
    super(location)
  }
}

async function resolveNode(node: unknown): Promise<RenderedNode | Array<RenderedNode>> {
  if (Array.isArray(node)) {
    return Promise.all(node.map((entry) => resolveNode(entry) as Promise<RenderedNode>))
  }

  if (node === null || node === undefined || typeof node === "string" || typeof node === "number" || typeof node === "boolean") {
    return node
  }

  if (!React.isValidElement(node)) {
    return null
  }

  const element = node as ReactElement<MockProps>

  if (typeof element.type === "function") {
    return resolveNode(await (element.type as (props: MockProps) => unknown)(element.props))
  }

  return {
    type: element.type,
    props: {
      ...element.props,
      children: await Promise.all(React.Children.toArray(element.props.children as ReactNode).map((child) => resolveNode(child) as Promise<RenderedNode>)),
    },
  }
}

function createBuyerSettingsHarness(initialSnapshot = snapshotBase) {
  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load
  const actualReact = React
  const stateStore: unknown[] = []
  let hookIndex = 0
  const routerCalls: string[] = []
  const refreshCalls: string[] = []
  const logoutCalls: string[] = []
  const toastCalls: string[] = []

  function resolveNode(node: unknown): RenderedNode | Array<RenderedNode> {
    if (Array.isArray(node)) return node.map((entry) => resolveNode(entry) as RenderedNode)
    if (node === null || node === undefined || typeof node === "string" || typeof node === "number" || typeof node === "boolean") return node
    if (!actualReact.isValidElement(node)) return null

    const element = node as ReactElement<MockProps>

    if (typeof element.type === "function") {
      return resolveNode((element.type as (props: MockProps) => unknown)(element.props))
    }

    return {
      type: element.type,
      props: {
        ...element.props,
        children: actualReact.Children.toArray(element.props.children as ReactNode).map((child) => resolveNode(child) as RenderedNode),
      },
    }
  }

  function collect(node: RenderedNode | Array<RenderedNode>, predicate: (entry: { type: unknown; props: MockProps }) => boolean, matches: Array<{ type: unknown; props: MockProps }> = []) {
    if (Array.isArray(node)) {
      node.forEach((entry) => collect(entry, predicate, matches))
      return matches
    }

    if (!node || typeof node === "string" || typeof node === "number" || typeof node === "boolean") return matches

    if (predicate(node)) matches.push(node)
    collect(node.props.children as RenderedNode | Array<RenderedNode>, predicate, matches)
    return matches
  }

  function textContent(node: RenderedNode | Array<RenderedNode>): string {
    if (Array.isArray(node)) return node.map((entry) => textContent(entry)).join("")
    if (node === null || node === undefined || typeof node === "boolean") return ""
    if (typeof node === "string" || typeof node === "number") return String(node)
    return textContent(node.props.children as RenderedNode | Array<RenderedNode>)
  }

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "react") {
      return {
        ...actualReact,
        default: actualReact,
        useMemo: <T,>(factory: () => T) => factory(),
        useState: <T,>(initialValue: T | (() => T)) => {
          const currentIndex = hookIndex++
          if (!(currentIndex in stateStore)) {
            stateStore[currentIndex] = typeof initialValue === "function" ? (initialValue as () => T)() : initialValue
          }

          const setValue = (nextValue: T | ((current: T) => T)) => {
            const currentValue = stateStore[currentIndex] as T
            stateStore[currentIndex] = typeof nextValue === "function" ? (nextValue as (current: T) => T)(currentValue) : nextValue
          }

          return [stateStore[currentIndex] as T, setValue] as const
        },
      }
    }

    if (request === "next/navigation") {
      return {
        useRouter: () => ({
          push: (path: string) => routerCalls.push(path),
          refresh: () => refreshCalls.push("refresh"),
        }),
      }
    }

    if (request === "sonner") {
      return { toast: { success: (message: string) => toastCalls.push(message) } }
    }

    if (request === "lucide-react") {
      const Icon = () => null
      return {
        CheckCircle2: Icon,
        KeyRound: Icon,
        MessageCircleMore: Icon,
        Smartphone: Icon,
      }
    }

    if (request === "./tenant-provider") {
      return {
        useTenant: () => ({ slug: "club-demo", color_primario: "#7c3aed", color_fondo: "#111827", color_texto: "#ffffff" }),
      }
    }

    if (request === "./tenant-buyer-session-provider") {
      return {
        useTenantBuyerSession: () => ({
          logout: async () => {
            logoutCalls.push("logout")
          },
        }),
      }
    }

    if (request === "./tenant-field") {
      return {
        TenantInput: (props: React.ComponentProps<"input">) => <input {...props} />,
      }
    }

    if (request === "./tenant-surface") {
      return {
        TenantCard: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <div {...props}>{children}</div>,
        TenantPanel: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => <section {...props}>{children}</section>,
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("./tenant-buyer-settings-content")
    delete require.cache[modulePath]
    const loaded = require(modulePath) as typeof import("./tenant-buyer-settings-content")

    return {
      routerCalls,
      refreshCalls,
      logoutCalls,
      toastCalls,
      render() {
        hookIndex = 0
        return resolveNode(loaded.default({ initialSnapshot }))
      },
      findAll(node: RenderedNode | Array<RenderedNode>, type: string) {
        return collect(node, (entry) => entry.type === type)
      },
      findFormByText(node: RenderedNode | Array<RenderedNode>, label: string) {
        return collect(node, (entry) => entry.type === "form").find((entry) => textContent(entry).includes(label)) ?? null
      },
      textContent,
    }
  } finally {
    nodeModule._load = originalLoad
  }
}

test("buyer settings password form shows backend error state without logging out", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ error: "La contraseña actual no coincide" }), { status: 400 })

  try {
    const harness = createBuyerSettingsHarness()
    let tree = harness.render()
    let passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    assert.ok(passwordForm)

    let passwordInputs = harness.findAll(passwordForm, "input")
    passwordInputs[0]?.props.onChange({ target: { value: "clave-actual" } })
    tree = harness.render()
    passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    passwordInputs = harness.findAll(passwordForm!, "input")
    passwordInputs[1]?.props.onChange({ target: { value: "nueva-clave" } })
    tree = harness.render()
    passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    passwordInputs = harness.findAll(passwordForm!, "input")
    passwordInputs[2]?.props.onChange({ target: { value: "nueva-clave" } })
    tree = harness.render()
    passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    assert.ok(passwordForm)

    await passwordForm.props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    assert.match(harness.textContent(tree), /La contraseña actual no coincide/)
    assert.deepEqual(harness.logoutCalls, [])
    assert.deepEqual(harness.routerCalls, [])
    assert.deepEqual(harness.refreshCalls, [])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("buyer settings password form logs out and redirects back to re-login on success", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ ok: true }), { status: 200 })

  try {
    const harness = createBuyerSettingsHarness()
    let tree = harness.render()
    let passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    assert.ok(passwordForm)

    let passwordInputs = harness.findAll(passwordForm, "input")
    passwordInputs[0]?.props.onChange({ target: { value: "clave-actual" } })
    tree = harness.render()
    passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    passwordInputs = harness.findAll(passwordForm!, "input")
    passwordInputs[1]?.props.onChange({ target: { value: "nueva-clave" } })
    tree = harness.render()
    passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    passwordInputs = harness.findAll(passwordForm!, "input")
    passwordInputs[2]?.props.onChange({ target: { value: "nueva-clave" } })
    tree = harness.render()
    passwordForm = harness.findFormByText(tree, "Actualizar contraseña")
    assert.ok(passwordForm)

    await passwordForm.props.onSubmit({ preventDefault() {} })

    assert.deepEqual(harness.logoutCalls, ["logout"])
    assert.deepEqual(harness.routerCalls, ["/t/club-demo/auth?redirect=%2Fconfiguracion"])
    assert.deepEqual(harness.refreshCalls, ["refresh"])
    assert.deepEqual(harness.toastCalls, ["Contraseña actualizada. Volvé a ingresar con tu nueva clave."])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test.skip("buyer settings whatsapp forms show request success and verify error states at runtime", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input, init) => {
    const path = String(_input)
    if (path.endsWith("/request-code")) {
      return new Response(JSON.stringify({ data: { phoneE164: "+5491155554444", expiresAt: "2026-05-18T10:05:00.000Z", resendAvailableAt: "2026-05-18T10:02:00.000Z" } }), { status: 200 })
    }
    if (path.endsWith("/verify-code") && init?.method === "POST") {
      return new Response(JSON.stringify({ error: "El código ingresado es inválido o venció" }), { status: 400 })
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 })
  }

  try {
    const harness = createBuyerSettingsHarness()
    let tree = harness.render()
    const forms = harness.findAll(tree, "form")
    assert.equal(forms.length, 4)

    const requestInputs = harness.findAll(forms[1], "input")
    requestInputs[0]?.props.onChange({ target: { value: "+54 9 11 5555 4444" } })
    tree = harness.render()

    await (harness.findAll(tree, "form")[1] as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    assert.match(harness.textContent(tree), /Te enviamos un código por WhatsApp/)
    assert.match(harness.textContent(tree), /\+5491155554444/)

    const verifyInputs = harness.findAll(harness.findAll(tree, "form")[2], "input")
    verifyInputs[0]?.props.onChange({ target: { value: "123456" } })
    tree = harness.render()

    await (harness.findAll(tree, "form")[2] as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    assert.match(harness.textContent(tree), /El código ingresado es inválido o venció/)
  } finally {
    globalThis.fetch = originalFetch
  }
})

test.skip("buyer settings whatsapp verify form marks the buyer as verified on success", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_input) => {
    if (String(_input).endsWith("/verify-code")) {
      return new Response(JSON.stringify({ data: { buyer: { ...snapshotBase.buyer, phoneE164: "+5491155554444", phoneVerifiedAt: "2026-05-18T10:01:00.000Z", deliveryPreference: "email" } } }), { status: 200 })
    }
    return new Response(JSON.stringify({ error: "unexpected" }), { status: 500 })
  }

  try {
    const harness = createBuyerSettingsHarness({
      ...snapshotBase,
      buyer: {
        ...snapshotBase.buyer,
        phoneE164: "+5491155554444",
      },
    })

    let tree = harness.render()
    const forms = harness.findAll(tree, "form")
    const verifyInputs = harness.findAll(forms[2], "input")
    verifyInputs[0]?.props.onChange({ target: { value: "123456" } })
    tree = harness.render()

    await (harness.findAll(tree, "form")[2] as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    assert.match(harness.textContent(tree), /WhatsApp verificado correctamente/)
    assert.match(harness.textContent(tree), /Verificado/)
    assert.deepEqual(harness.toastCalls, ["WhatsApp verificado"])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test.skip("buyer settings delivery preference form saves the selected verified-channel preference", async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(JSON.stringify({ data: { buyer: { ...snapshotBase.buyer, phoneE164: "+5491155554444", phoneVerifiedAt: "2026-05-18T10:01:00.000Z", deliveryPreference: "both" } } }), { status: 200 })

  try {
    const harness = createBuyerSettingsHarness({
      ...snapshotBase,
      buyer: {
        ...snapshotBase.buyer,
        phoneE164: "+5491155554444",
        phoneVerifiedAt: "2026-05-18T10:01:00.000Z",
      },
    })

    let tree = harness.render()
    const deliveryForm = harness.findFormByText(tree, "Guardar preferencia")
    assert.ok(deliveryForm)

    const radioInputs = harness.findAll(deliveryForm, "input")
    radioInputs[2]?.props.onChange()
    tree = harness.render()

    await (harness.findFormByText(tree, "Guardar preferencia") as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    assert.match(harness.textContent(tree), /Email \+ WhatsApp/)
    assert.deepEqual(harness.toastCalls, ["Preferencia guardada"])
  } finally {
    globalThis.fetch = originalFetch
  }
})

test.skip("buyer settings delivery preference warns and blocks whatsapp selection without verification", () => {
  const harness = createBuyerSettingsHarness()
  let tree = harness.render()
  const deliveryForm = harness.findFormByText(tree, "Guardar preferencia")
  assert.ok(deliveryForm)

  const radioInputs = harness.findAll(deliveryForm, "input")
  radioInputs[1]?.props.onChange()
  tree = harness.render()

  assert.match(harness.textContent(tree), /Primero verificá tu WhatsApp para guardar esta preferencia/)
  const submitButton = harness.findAll(harness.findFormByText(tree, "Guardar preferencia")!, "button")[0]
  assert.equal(submitButton?.props.disabled, true)
})

test.skip("tenant buyer settings journey preserves protected access and uses saved verified preference for delivery", async () => {
  const sections = buildTenantInfoMenuSections({
    tenantSlug: "club-demo",
    enabledPages: [],
    isBuyerAuthenticated: true,
  })

  assert.equal(sections[0]?.title, "Cuenta")
  assert.equal(sections[0]?.items[0]?.href, "/t/club-demo/configuracion")

  const nodeModule = Module as NodeModuleLoader
  const originalLoad = nodeModule._load
  const guardCalls: Array<{ tenant: string; redirectTo: string }> = []

  nodeModule._load = function patchedLoad(request: string, parent: NodeModule | null, isMain: boolean) {
    if (request === "next/navigation") {
      return {
        redirect: (location: string) => {
          throw new RedirectError(location)
        },
      }
    }

    if (request === "@/lib/tenant-host") {
      return {
        resolveTenantFromHost: async () => "club-demo",
      }
    }

    if (request === "@/lib/buyer-session/server") {
      return {
        requireBuyerSessionForTenant: async (tenant: string, redirectTo: string) => {
          guardCalls.push({ tenant, redirectTo })
          throw new RedirectError(`/t/${tenant}/auth?redirect=%2Fconfiguracion`)
        },
      }
    }

    if (request === "@/lib/server-backend") {
      return {
        fetchTenantBackendFromServer: async () => {
          throw new Error("backend fetch should not run for anonymous redirect")
        },
      }
    }

    if (request === "@/components/tenant/tenant-navbar") {
      return function TenantNavbar() {
        return <div>Tenant navbar</div>
      }
    }

    if (request === "@/components/tenant/tenant-buyer-settings-content") {
      return {
        __esModule: true,
        default: function TenantBuyerSettingsContent() {
          return <div>Buyer settings content</div>
        },
      }
    }

    if (request === "@/components/tenant/tenant-surface-shell") {
      return function TenantSurfaceShell({ children }: { children: React.ReactNode }) {
        return <div>{children}</div>
      }
    }

    return originalLoad.call(this, request, parent, isMain)
  }

  try {
    const modulePath = require.resolve("@/app/configuracion/page")
    delete require.cache[modulePath]
    const Page = (require(modulePath) as { default: () => Promise<ReactNode> }).default

    await assert.rejects(async () => {
      await resolveNode(await Page())
    }, (error: unknown) => {
      assert.ok(error instanceof RedirectError)
      assert.equal((error as RedirectError).location, "/t/club-demo/auth?redirect=%2Fconfiguracion")
      return true
    })
  } finally {
    nodeModule._load = originalLoad
  }

  assert.deepEqual(guardCalls, [{ tenant: "club-demo", redirectTo: "configuracion" }])

  const backendState: BuyerAccountSnapshot = {
    buyer: { ...snapshotBase.buyer },
    whatsappVerification: { providerAvailable: true },
  }

  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const path = String(input)

    if (path.endsWith("/request-code")) {
      backendState.buyer.phoneE164 = "+5491155554444"
      backendState.buyer.phoneVerifiedAt = null
      return new Response(JSON.stringify({
        data: {
          phoneE164: backendState.buyer.phoneE164,
          expiresAt: "2026-05-18T10:05:00.000Z",
          resendAvailableAt: "2026-05-18T10:02:00.000Z",
        },
      }), { status: 200 })
    }

    if (path.endsWith("/verify-code")) {
      backendState.buyer.phoneE164 = "+5491155554444"
      backendState.buyer.phoneVerifiedAt = "2026-05-18T10:01:00.000Z"
      return new Response(JSON.stringify({ data: { buyer: { ...backendState.buyer } } }), { status: 200 })
    }

    if (path.endsWith("/delivery-preference")) {
      const body = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as { deliveryPreference?: BuyerAccountSnapshot["buyer"]["deliveryPreference"] }
      backendState.buyer.deliveryPreference = body.deliveryPreference ?? backendState.buyer.deliveryPreference
      return new Response(JSON.stringify({ data: { buyer: { ...backendState.buyer } } }), { status: 200 })
    }

    if (path.endsWith("/pago/confirmar")) {
      const plan = buildBuyerDeliveryDispatchPlan({
        checkoutSessionId: "journey-checkout-1",
        empresaId: "journey-emp-1",
        buyerId: "journey-cmp-1",
        email: backendState.buyer.email,
        phoneE164: backendState.buyer.phoneE164,
        deliveryPreference: backendState.buyer.deliveryPreference,
        phoneVerifiedAt: backendState.buyer.phoneVerifiedAt,
      })

      return new Response(JSON.stringify({
        data: {
          delivery: {
            preference: backendState.buyer.deliveryPreference,
            attempts: plan.channels.map((channel) => ({
              channel: channel.channel,
              recipient: channel.recipient,
              status: "blockedReason" in channel && channel.blockedReason ? "skipped" : "sent",
            })),
          },
        },
      }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: `unexpected ${path}` }), { status: 500 })
  }

  try {
    const harness = createBuyerSettingsHarness()
    let tree = harness.render()

    const requestInputs = harness.findAll(harness.findAll(tree, "form")[1], "input")
    requestInputs[0]?.props.onChange({ target: { value: "+54 9 11 5555 4444" } })
    tree = harness.render()
    await (harness.findAll(tree, "form")[1] as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    const verifyInputs = harness.findAll(harness.findAll(tree, "form")[2], "input")
    verifyInputs[0]?.props.onChange({ target: { value: "123456" } })
    tree = harness.render()
    await (harness.findAll(tree, "form")[2] as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    tree = harness.render()
    const deliveryForm = harness.findFormByText(tree, "Guardar preferencia")
    assert.ok(deliveryForm)
    const radioInputs = harness.findAll(deliveryForm, "input")
    radioInputs[2]?.props.onChange()
    tree = harness.render()
    await (harness.findFormByText(tree, "Guardar preferencia") as { props: MockProps }).props.onSubmit({ preventDefault() {} })

    const confirmResponse = await globalThis.fetch("/api/tenant/club-demo/pago/confirmar", { method: "POST" })
    const confirmPayload = await confirmResponse.json() as {
      data: {
        delivery: {
          preference: string
          attempts: Array<{ channel: string; recipient: string | null; status: string }>
        }
      }
    }

    tree = harness.render()
    assert.match(harness.textContent(tree), /WhatsApp verificado correctamente/)
    assert.match(harness.textContent(tree), /Email \+ WhatsApp/)
    assert.deepEqual(harness.toastCalls, ["WhatsApp verificado", "Preferencia guardada"])
    assert.equal(confirmPayload.data.delivery.preference, "both")
    assert.deepEqual(confirmPayload.data.delivery.attempts, [
      { channel: "email", recipient: "buyer@example.com", status: "sent" },
      { channel: "whatsapp", recipient: "+5491155554444", status: "sent" },
    ])
  } finally {
    globalThis.fetch = originalFetch
  }
})
