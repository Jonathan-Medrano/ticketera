import assert from "node:assert/strict"
import { test } from "node:test"
import { getPlatformConsoleHomePath, hasPlatformCapability, hasPlatformPermission, hasPlatformRevenueScope, isPlatformConsoleActor } from "@/lib/internal-actor-routing"

test("internal actor routing resolves platform capabilities from explicit metadata or legacy permissions", () => {
  const globalCapabilities = ["platform.companies.read", "platform.settings.read", "platform.revenue.view.global"] as Array<"platform.companies.read" | "platform.settings.read" | "platform.revenue.view.global">
  const legacyUser = {
    userType: "platform_staff" as const,
    singletonKey: null,
    permisos: {
      platform_dashboard: true,
      platform_empresas: false,
      platform_configuracion: false,
      platform_usuarios: true,
    },
  }

  assert.equal(hasPlatformPermission(legacyUser, "platform_dashboard"), true)
  assert.equal(hasPlatformCapability(legacyUser, "platform.users.write"), true)
  assert.equal(hasPlatformCapability(legacyUser, "platform.revenue.view.global"), false)
  assert.equal(hasPlatformCapability(legacyUser, "platform.settings.read"), false)

  const explicitUser = {
    userType: "platform_staff" as const,
    singletonKey: null,
    platformCapabilities: globalCapabilities,
    platformViewerPolicy: {
      actorUserId: "u1",
      parentUserId: null,
      branchRootUserId: "u1",
      rootUserId: "root",
      roleLabel: "staff",
      isRoot: false,
      compatibilityMode: "grants" as const,
      capabilities: globalCapabilities,
      capabilityCeiling: globalCapabilities,
      revenueVisibilityScope: "global" as const,
    },
  }

  assert.equal(hasPlatformCapability(explicitUser, "platform.companies.read"), true)
  assert.equal(hasPlatformCapability(explicitUser, "platform.settings.read"), true)
  assert.equal(hasPlatformRevenueScope(explicitUser, "global"), true)
  assert.equal(hasPlatformPermission({ userType: "platform_staff", platformCapabilities: ["platform.settings.read"] }, "platform_configuracion"), true)
})

test("platform console home path falls back to first accessible module", () => {
  assert.equal(getPlatformConsoleHomePath({ userType: "super_admin" }), "/super-admin/dashboard")
  assert.equal(isPlatformConsoleActor({ roleSlug: "superadmin" }), true)
  assert.equal(isPlatformConsoleActor({ roleSlug: "staff" }), true)
  assert.equal(getPlatformConsoleHomePath({ userType: "platform_staff", platformCapabilities: ["platform.users.read"] }), "/super-admin/usuarios")
  assert.equal(getPlatformConsoleHomePath({ userType: "platform_staff", platformCapabilities: ["platform.settings.read"] }), "/super-admin/configuracion")
  assert.equal(getPlatformConsoleHomePath({ userType: "platform_staff", platformCapabilities: ["platform.companies.read"] }), "/super-admin/empresas")
  assert.equal(getPlatformConsoleHomePath({ userType: "platform_staff", platformCapabilities: [] }), "/")
})
