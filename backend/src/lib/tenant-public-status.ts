// tenant_public_disabled + tenant_public_disabled_at are declared in prisma/schema.prisma
// (Empresa model) — no runtime ALTER needed with Prisma managing the schema.

export function normalizeTenantPublicDisabled(value: unknown) {
  return value === true || Number(value) === 1
}
