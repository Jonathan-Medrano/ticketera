import assert from "node:assert/strict"
import { mock, test } from "node:test"
import bcrypt from "bcryptjs"
import { authConfig } from "@/auth.config"
import { getInternalActorHomePath } from "@/lib/auth-identities"

type PlatformAdminRow = Record<string, unknown>
type EmpresaRow = Record<string, unknown>

// resolveCompanyOrSuperAdminLogin now reads the singleton Prisma client from
// "@/lib/prisma" instead of taking a query fn. Mock platformAdminUser/empresa
// findFirst so the test exercises the real resolution logic without a live DB.
function mockPrisma(options: {
  platformAdminRow?: PlatformAdminRow | null
  empresaRow?: EmpresaRow | null
}) {
  const prisma = {
    platformAdminUser: {
      findFirst: async () => options.platformAdminRow ?? null,
    },
    empresa: {
      findFirst: async () => options.empresaRow ?? null,
    },
  }

  mock.module("@/lib/prisma", { namedExports: { prisma } })
}

async function importResolve() {
  const mod = await import("@/lib/auth-identities")
  return mod.resolveCompanyOrSuperAdminLogin
}

test("super-admin identity resolves from general login flow", async () => {
  const hash = await bcrypt.hash("super-secret-123", 12)

  mockPrisma({
    platformAdminRow: {
      id: "phase6-admin-1",
      nombre: "Owner Platea",
      email: "phase6-owner@example.com",
      password: hash,
      permisos: null,
      role_slug: "superadmin",
      singleton_key: "superadmin",
      must_change_password: false,
    },
  })

  const resolveCompanyOrSuperAdminLogin = await importResolve()
  const identity = await resolveCompanyOrSuperAdminLogin("superadmin", "super-secret-123")

  assert.equal(identity?.userType, "super_admin")
  assert.equal(identity?.id, "phase6-admin-1")

  mock.restoreAll()
})

test("platform staff identity resolves before tenant users without tenant escalation", async () => {
  const hash = await bcrypt.hash("super-secret-123", 12)

  mockPrisma({
    platformAdminRow: {
      id: "phase6-admin-2",
      nombre: "Staff Platea",
      email: "phase6-staff@example.com",
      password: hash,
      permisos: null,
      role_slug: "staff",
      singleton_key: null,
      must_change_password: false,
    },
    empresaRow: {
      id: "phase6-emp-2",
      nombre: "Empresa Demo",
      slug: "phase6-empresa-2",
      email: "phase6-staff@example.com",
      password: hash,
    },
  })

  const resolveCompanyOrSuperAdminLogin = await importResolve()
  const identity = await resolveCompanyOrSuperAdminLogin("phase6-staff@example.com", "super-secret-123")

  assert.equal(identity?.userType, "platform_staff")
  assert.equal(identity?.id, "phase6-admin-2")

  mock.restoreAll()
})

test("public empresa signup identity is not escalated to super-admin", async () => {
  const hash = await bcrypt.hash("super-secret-123", 12)

  mockPrisma({
    platformAdminRow: null,
    empresaRow: {
      id: "phase6-emp-1",
      nombre: "Empresa Demo",
      slug: "phase6-empresa",
      email: "phase6-empresa@example.com",
      password: hash,
      admin_nombre: "Admin",
      admin_apellido: "Demo",
    },
  })

  const resolveCompanyOrSuperAdminLogin = await importResolve()
  const identity = await resolveCompanyOrSuperAdminLogin("phase6-empresa@example.com", "super-secret-123")

  assert.equal(identity?.userType, "empresa")
  assert.equal(identity?.id, "phase6-emp-1")

  mock.restoreAll()
})

test("internal actor home path keeps platform actors on canonical super-admin dashboard", () => {
  assert.equal(getInternalActorHomePath("super_admin"), "/super-admin/dashboard")
  assert.equal(getInternalActorHomePath("platform_staff"), "/super-admin/dashboard")
  assert.equal(getInternalActorHomePath("empresa"), "/dashboard")
  assert.equal(getInternalActorHomePath("empleado"), "/dashboard")
})

async function resolveAuthorized(pathname: string, user?: Record<string, unknown>) {
  return authConfig.callbacks?.authorized?.({
    auth: user ? ({ user } as never) : null,
    request: { nextUrl: new URL(`https://platea.test${pathname}`) } as never,
  })
}

test("auth redirect keeps platform staff out of tenant dashboard and routes them to super-admin", async () => {
  const result = await resolveAuthorized("/dashboard", {
    id: "phase6-platform-staff",
    userType: "platform_staff",
    platformCapabilities: ["platform.users.read"],
  })

  assert.ok(result instanceof Response)
  assert.equal(result.status, 302)
  assert.equal(result.headers.get("location"), "https://platea.test/super-admin/usuarios")
})

test("auth redirect rejects tenant actors from super-admin surfaces", async () => {
  const result = await resolveAuthorized("/super-admin/dashboard", {
    id: "phase6-empresa-redirect",
    slug: "empresa-demo",
    userType: "empresa",
  })

  assert.equal(result, true)
})

test("protected super-admin routes still require a valid authenticated identity", async () => {
  const result = await resolveAuthorized("/super-admin/dashboard")

  assert.ok(result instanceof Response)
  assert.equal(result.status, 302)
  assert.equal(result.headers.get("location"), "https://platea.test/login?reason=session")
})

test("forced password rotation redirects flagged employees away from dashboard and login", async () => {
  const dashboardResult = await resolveAuthorized("/dashboard", {
    id: "phase6-employee-force-1",
    userType: "empleado",
    empresa_id: "emp-1",
    mustChangePassword: true,
  })

  assert.ok(dashboardResult instanceof Response)
  assert.equal(dashboardResult.status, 302)
  assert.equal(dashboardResult.headers.get("location"), "https://platea.test/dashboard/actualizar-password")

  const loginResult = await resolveAuthorized("/login", {
    id: "phase6-employee-force-1",
    userType: "empleado",
    empresa_id: "emp-1",
    mustChangePassword: true,
  })

  assert.ok(loginResult instanceof Response)
  assert.equal(loginResult.status, 302)
  assert.equal(loginResult.headers.get("location"), "https://platea.test/dashboard/actualizar-password")
})

test("forced password rotation blocks revendedor access for flagged employees", async () => {
  const result = await resolveAuthorized("/revendedor", {
    id: "phase6-employee-force-3",
    userType: "empleado",
    empresa_id: "emp-1",
    mustChangePassword: true,
  })

  assert.ok(result instanceof Response)
  assert.equal(result.status, 302)
  assert.equal(result.headers.get("location"), "https://platea.test/dashboard/actualizar-password")
})

test("forced password rotation also blocks platform staff from super-admin surfaces", async () => {
  const result = await resolveAuthorized("/super-admin/dashboard", {
    id: "phase6-platform-force-1",
    userType: "platform_staff",
    platformCapabilities: ["platform.users.read"],
    mustChangePassword: true,
  })

  assert.ok(result instanceof Response)
  assert.equal(result.status, 302)
  assert.equal(result.headers.get("location"), "https://platea.test/dashboard/actualizar-password")
})

test("forced password rotation never traps singleton super-admin boot users", async () => {
  const result = await resolveAuthorized("/super-admin/dashboard", {
    id: "phase6-superadmin-safe-1",
    userType: "super_admin",
    singletonKey: "superadmin",
    mustChangePassword: true,
  })

  assert.equal(result, true)
})

test("forced password rotation allowlists the dedicated password update route", async () => {
  const result = await resolveAuthorized("/dashboard/actualizar-password", {
    id: "phase6-employee-force-2",
    userType: "empleado",
    empresa_id: "emp-1",
    mustChangePassword: true,
  })

  assert.equal(result, true)
})
