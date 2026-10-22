import assert from "node:assert/strict"
import test from "node:test"

import {
  buildRefundExportPath,
  loadRefundsDashboardData,
  readRefundsPageRequest,
} from "./page-model"

test("refunds page request reads server-side filters and preserves selected case id", () => {
  const result = readRefundsPageRequest({
    query: "target text ",
    buyer: "Ana ",
    event: "Festival Uno",
    flow: "consumibles",
    sortOrder: "date_asc",
    caseId: "case-2",
    page: "9",
    pageSize: "100",
  })

  assert.deepEqual(result.filters, {
    query: "target text ",
    buyer: "Ana ",
    event: "Festival Uno",
    flow: "consumibles",
    sortOrder: "date_asc",
  })
  assert.equal(result.selectedCaseId, "case-2")
})

test("refund export path keeps only active filters and sort while excluding pagination", () => {
  assert.equal(
    buildRefundExportPath({
      query: "ana maria",
      buyer: "Ana",
      event: "Festival Uno",
      flow: "entradas",
      sortOrder: "date_asc",
      caseId: "case-2",
      page: "4",
      pageSize: "25",
    }),
    "/api/reembolsos/export?query=ana+maria&buyer=Ana&event=Festival+Uno&flow=entradas&sortOrder=date_asc"
  )
})

test("refunds page forwards list filters to backend and derives export path from the same server-side scope", async () => {
  const requests: string[] = []

  const result = await loadRefundsDashboardData({
    searchParams: {
      query: "target",
      buyer: "Ana",
      event: "Festival Uno",
      flow: "consumibles",
      sortOrder: "date_asc",
      caseId: "case-2",
      page: "8",
      pageSize: "100",
    },
    fetchBackendFromServer: async <T,>(path: string) => {
      requests.push(path)
      return {
        data: {
          cases: [{ id: "case-2" }],
          automatic_refund_config: { enabled: false, mode: "manual", scope: "todos" },
        },
      } as T
    },
  })

  assert.deepEqual(requests, [
    "/api/reembolsos?query=target&buyer=Ana&event=Festival+Uno&flow=consumibles&sortOrder=date_asc&page=8&pageSize=100",
  ])
  assert.equal(result.exportPath, "/api/reembolsos/export?query=target&buyer=Ana&event=Festival+Uno&flow=consumibles&sortOrder=date_asc")
  assert.equal(result.selectedCaseId, "case-2")
})
