import assert from "node:assert/strict"
import { test } from "node:test"
import {
  getPlatformHealthExecutiveCopy,
  getPlatformHealthPrimaryCta,
  getPlatformHealthSeverity,
  truncatePlatformIssueCompanies,
} from "@/components/super-admin/dashboard-health"
import { buildEmptyPlatformHealthSnapshot, normalizePlatformDashboardData, type PlatformDashboardResponseData } from "@/components/super-admin/types"

test("normaliza dashboard platform desde camelCase o snake_case incluyendo health snapshot", () => {
  const healthSnapshot = buildEmptyPlatformHealthSnapshot()
  const contract: PlatformDashboardResponseData = {
    metricas: {
      empresasActivas: 4,
      ventasTotales: 12,
      volumenBruto: 250000,
      gananciasOwner: 15000,
    },
    metricas_por_flow: {
      entradas: { ventasTotales: 10, volumenBruto: 200000, gananciasOwner: 12000 },
      consumibles: { ventasTotales: 2, volumenBruto: 50000, gananciasOwner: 3000 },
    },
    ganancias_por_dia: [{ dia: "2026-05-09", total: 15000 }],
    empresas_resumen: [],
    health_snapshot: {
      ...healthSnapshot,
      ownerStatus: {
        status: "ready_to_sell",
        reason: null,
        updatedAt: "2026-05-09T10:00:00.000Z",
      },
    },
    profit_sharing: {
      cutoff: {
        startsAt: "2026-05-10T12:00:00.000Z",
        source: "first_allocation",
      },
      totalsByFlow: {
        entradas: { ownerFeeTotal: 10, assignedPercentage: 25, remainderPercentage: 75 },
        consumibles: { ownerFeeTotal: 5, assignedPercentage: 0, remainderPercentage: 100 },
      },
      users: [],
    },
  }

  const normalized = normalizePlatformDashboardData(contract)

  assert.equal(normalized.metricasPorFlow.entradas.ventasTotales, 10)
  assert.equal(normalized.gananciasPorDia[0]?.total, 15000)
  assert.deepEqual(normalized.healthSnapshot, contract.health_snapshot)
  assert.equal(normalized.profitSharing?.cutoff.startsAt, "2026-05-10T12:00:00.000Z")
})

test("dashboard health helpers resuelven severidad, copy ejecutivo y CTA honestos", () => {
  const missingOwnerSnapshot = buildEmptyPlatformHealthSnapshot()

  assert.equal(getPlatformHealthSeverity("missing_collection_setup"), "warning")
  assert.equal(getPlatformHealthSeverity("missing_marketplace_fee"), "warning")
  assert.equal(getPlatformHealthSeverity("ready_to_sell"), "success")
  assert.equal(getPlatformHealthSeverity("deactivated"), "neutral")

  assert.deepEqual(getPlatformHealthPrimaryCta(missingOwnerSnapshot), {
    label: "Configurar cuenta owner",
    href: "/super-admin/configuracion",
  })
  assert.equal(getPlatformHealthExecutiveCopy(missingOwnerSnapshot).title, "Todavía falta configurar la cuenta owner")

  const readyButBlockedSnapshot = {
    ...missingOwnerSnapshot,
    ownerStatus: {
      status: "ready_to_sell" as const,
      reason: null,
      updatedAt: "2026-05-09T11:00:00.000Z",
    },
    issueCounters: {
      ...missingOwnerSnapshot.issueCounters,
      total: 2,
      missingCollectionSetup: 1,
      deactivated: 1,
    },
  }

  assert.deepEqual(getPlatformHealthPrimaryCta(readyButBlockedSnapshot), {
    label: "Ir a empresas accionables",
    href: "/super-admin/empresas",
  })
  assert.match(getPlatformHealthExecutiveCopy(readyButBlockedSnapshot).description, /2 empresa/)
})

test("dashboard health truncation limita empresas sin perder el resto", () => {
  const companies = [
    { id: "1", nombre: "A", slug: "a", activa: true, withOverrides: false, readiness: { status: "blocked", reason: "manual_block", canSell: false } },
    { id: "2", nombre: "B", slug: "b", activa: true, withOverrides: true, readiness: { status: "blocked", reason: "manual_block", canSell: false } },
    { id: "3", nombre: "C", slug: "c", activa: true, withOverrides: false, readiness: { status: "pending_validation", reason: "validation_pending", canSell: false } },
    { id: "4", nombre: "D", slug: "d", activa: true, withOverrides: false, readiness: { status: "missing_provider", reason: "missing_provider", canSell: false } },
  ]

  const truncated = truncatePlatformIssueCompanies(companies, 3)

  assert.equal(truncated.items.length, 3)
  assert.equal(truncated.hiddenCount, 1)
  assert.deepEqual(truncated.items.map((company) => company.id), ["1", "2", "3"])
})
