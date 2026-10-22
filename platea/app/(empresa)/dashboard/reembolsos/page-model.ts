import type { RefundAutomaticConfig, RefundCaseFilters, RefundManualCaseSummary } from "@/components/dashboard/reembolsos-model"

type FetchBackend = <T>(path: string) => Promise<T>

export type RefundListResponse = {
  data: {
    cases: RefundManualCaseSummary[]
    automatic_refund_config: RefundAutomaticConfig
    buyer_event_refunds_enabled: boolean
  }
}

export type RefundsPageSearchParams = Record<string, string | string[] | undefined>

function readValue(source: RefundsPageSearchParams, key: string) {
  const value = source[key]
  if (Array.isArray(value)) return value[0]
  return value
}

function normalizeFlow(value?: string) {
  return value === "entradas" || value === "consumibles" ? value : "all"
}

function normalizeSortOrder(value?: string) {
  return value === "date_asc" ? "date_asc" : "date_desc"
}

export function readRefundsPageRequest(searchParams: RefundsPageSearchParams) {
  return {
    filters: {
      query: readValue(searchParams, "query") ?? "",
      buyer: readValue(searchParams, "buyer") ?? "",
      event: readValue(searchParams, "event") ?? "all",
      flow: normalizeFlow(readValue(searchParams, "flow")),
      sortOrder: normalizeSortOrder(readValue(searchParams, "sortOrder")),
    } satisfies RefundCaseFilters,
    selectedCaseId: readValue(searchParams, "caseId") ?? null,
    page: readValue(searchParams, "page") ?? "",
    pageSize: readValue(searchParams, "pageSize") ?? "",
  }
}

function buildRefundListQuery(searchParams: RefundsPageSearchParams) {
  const request = readRefundsPageRequest(searchParams)
  const params = new URLSearchParams()

  if (request.filters.query) params.set("query", request.filters.query)
  if (request.filters.buyer) params.set("buyer", request.filters.buyer)
  if (request.filters.event !== "all") params.set("event", request.filters.event)
  if (request.filters.flow !== "all") params.set("flow", request.filters.flow)
  if (request.filters.sortOrder !== "date_desc") params.set("sortOrder", request.filters.sortOrder)
  if (request.page) params.set("page", request.page)
  if (request.pageSize) params.set("pageSize", request.pageSize)

  return params.toString()
}

export function buildRefundExportPath(searchParams: RefundsPageSearchParams) {
  const request = readRefundsPageRequest(searchParams)
  const params = new URLSearchParams()

  if (request.filters.query) params.set("query", request.filters.query)
  if (request.filters.buyer) params.set("buyer", request.filters.buyer)
  if (request.filters.event !== "all") params.set("event", request.filters.event)
  if (request.filters.flow !== "all") params.set("flow", request.filters.flow)
  if (request.filters.sortOrder !== "date_desc") params.set("sortOrder", request.filters.sortOrder)

  const query = params.toString()
  return `/api/reembolsos/export${query ? `?${query}` : ""}`
}

export async function loadRefundsDashboardData({
  searchParams,
  fetchBackendFromServer,
}: {
  searchParams: RefundsPageSearchParams
  fetchBackendFromServer: FetchBackend
}) {
  const listQuery = buildRefundListQuery(searchParams)
  const response = await fetchBackendFromServer<RefundListResponse>(`/api/reembolsos${listQuery ? `?${listQuery}` : ""}`)
  const request = readRefundsPageRequest(searchParams)

  return {
    cases: response.data.cases,
    automaticRefundConfig: response.data.automatic_refund_config,
    buyerEventRefundsEnabled: response.data.buyer_event_refunds_enabled ?? false,
    initialFilters: request.filters,
    exportPath: buildRefundExportPath(searchParams),
    selectedCaseId: request.selectedCaseId,
  }
}
