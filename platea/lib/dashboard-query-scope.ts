import { writeDashboardSearchParam } from "@/lib/dashboard-grid-search"

type SearchParamsSource =
  | { get(name: string): string | null; toString(): string }
  | Record<string, string | string[] | undefined>
  | null
  | undefined

type QueryKeyMap = Record<string, string>

type QueryResult<TMap extends QueryKeyMap> = Partial<Record<keyof TMap, string>>

type QueryPatch<TMap extends QueryKeyMap> = Partial<Record<keyof TMap, string | number | null | undefined>>

type QueryDefaults<TMap extends QueryKeyMap> = Partial<Record<keyof TMap, string>>

export const DASHBOARD_VENTAS_TABS = ["entradas", "consumibles"] as const

export type DashboardVentasTab = (typeof DASHBOARD_VENTAS_TABS)[number]
export type EntradasDashboardQueryScope = "" | "entradas"

export const ENTRADAS_QUERY_KEYS = {
  page: "page",
  pageSize: "pageSize",
  busqueda: "busqueda",
  evento: "evento",
  categoria_id: "categoria_id",
  estado: "estado",
  desde: "desde",
  hasta: "hasta",
  sortBy: "sortBy",
  sortDir: "sortDir",
} as const

export const CONSUMIBLES_VENTAS_QUERY_KEYS = {
  page: "page",
  pageSize: "pageSize",
  busqueda: "busqueda",
  evento_id: "evento_id",
  barra_id: "barra_id",
  estado: "estado",
  desde: "desde",
  hasta: "hasta",
  sortBy: "sortBy",
  sortDir: "sortDir",
} as const

export type EntradasDashboardQuery = QueryResult<typeof ENTRADAS_QUERY_KEYS>
export type ConsumiblesVentasDashboardQuery = QueryResult<typeof CONSUMIBLES_VENTAS_QUERY_KEYS>
export type ConsumiblesVentasQueryScope = "" | "cv" | "consumibles"

function toPascalCase(value: string) {
  return value
    .replace(/([A-Z])/g, "_$1")
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
}

export function buildScopedQueryKey(prefix: string, key: string) {
  if (!prefix) return key
  return `${prefix}${toPascalCase(key)}`
}

function getEntradasPrefix(scope: EntradasDashboardQueryScope) {
  return scope === "entradas" ? "ve" : ""
}

function getConsumiblesPrefix(scope: ConsumiblesVentasQueryScope) {
  if (scope === "consumibles") return "vc"
  return scope
}

function readValue(source: SearchParamsSource, key: string) {
  if (!source) return undefined

  if (typeof (source as { get(name: string): string | null }).get === "function") {
    const value = (source as { get(name: string): string | null }).get(key)
    return value ?? undefined
  }

  const rawValue = (source as Record<string, string | string[] | undefined>)[key]
  if (Array.isArray(rawValue)) return rawValue[0]
  return rawValue ?? undefined
}

function cloneSearchParams(source: SearchParamsSource) {
  if (!source) return new URLSearchParams()

  if (typeof (source as { get(name: string): string | null; toString(): string }).get === "function") {
    return new URLSearchParams((source as { toString(): string }).toString())
  }

  const params = new URLSearchParams()

  for (const [key, value] of Object.entries(source as Record<string, string | string[] | undefined>)) {
    if (Array.isArray(value)) {
      if (value[0]) params.set(key, value[0])
      continue
    }

    if (value) params.set(key, value)
  }

  return params
}

export function readScopedParams<TMap extends QueryKeyMap>(
  source: SearchParamsSource,
  prefix: string,
  keys: TMap
): QueryResult<TMap> {
  const result: QueryResult<TMap> = {}

  for (const [field, key] of Object.entries(keys) as Array<[keyof TMap, string]>) {
    const value = readValue(source, buildScopedQueryKey(prefix, key))
    if (value) result[field] = value
  }

  return result
}

export function writeScopedParams<TMap extends QueryKeyMap>(
  current: SearchParamsSource,
  prefix: string,
  keys: TMap,
  patch: QueryPatch<TMap>,
  defaults: QueryDefaults<TMap> = {}
) {
  const params = cloneSearchParams(current)

  for (const [field, value] of Object.entries(patch) as Array<[keyof TMap, string | number | null | undefined]>) {
    const scopedKey = buildScopedQueryKey(prefix, keys[field])

    if (field === "busqueda") {
      writeDashboardSearchParam(
        params,
        scopedKey,
        value === null || value === undefined ? value : String(value)
      )
      continue
    }

    const normalized = value === null || value === undefined ? "" : String(value).trim()

    if (!normalized || defaults[field] === normalized) {
      params.delete(scopedKey)
      continue
    }

    params.set(scopedKey, normalized)
  }

  return params
}

export function buildScopedQueryString<TMap extends QueryKeyMap>(
  values: QueryResult<TMap>,
  prefix: string,
  keys: TMap,
  defaults: QueryDefaults<TMap> = {}
) {
  return writeScopedParams<TMap>(undefined, prefix, keys, values, defaults).toString()
}

export function readVentasTab(source: SearchParamsSource): DashboardVentasTab | undefined {
  const value = readValue(source, "tab")
  return DASHBOARD_VENTAS_TABS.find((tab) => tab === value)
}

export function writeVentasTab(current: SearchParamsSource, tab: DashboardVentasTab) {
  const params = cloneSearchParams(current)
  params.set("tab", tab)
  return params
}

export function buildVentasTabHref(pathname: string, current: SearchParamsSource, tab: DashboardVentasTab) {
  const params = writeVentasTab(current, tab)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function readEntradasQuery(source: SearchParamsSource, scope: EntradasDashboardQueryScope = "") {
  return readScopedParams(source, getEntradasPrefix(scope), ENTRADAS_QUERY_KEYS)
}

export function writeEntradasQuery(
  current: SearchParamsSource,
  patch: QueryPatch<typeof ENTRADAS_QUERY_KEYS>,
  scope: EntradasDashboardQueryScope = ""
) {
  return writeScopedParams(current, getEntradasPrefix(scope), ENTRADAS_QUERY_KEYS, patch, {
    evento: "todos",
    estado: "todos",
  })
}

export function buildEntradasQueryString(values: EntradasDashboardQuery, scope: EntradasDashboardQueryScope = "") {
  return buildScopedQueryString(values, getEntradasPrefix(scope), ENTRADAS_QUERY_KEYS, {
    evento: "todos",
    estado: "todos",
  })
}

export function readConsumiblesVentasQuery(source: SearchParamsSource, prefix: ConsumiblesVentasQueryScope = "") {
  return readScopedParams(source, getConsumiblesPrefix(prefix), CONSUMIBLES_VENTAS_QUERY_KEYS)
}

export function writeConsumiblesVentasQuery(
  current: SearchParamsSource,
  patch: QueryPatch<typeof CONSUMIBLES_VENTAS_QUERY_KEYS>,
  prefix: ConsumiblesVentasQueryScope = ""
) {
  return writeScopedParams(current, getConsumiblesPrefix(prefix), CONSUMIBLES_VENTAS_QUERY_KEYS, patch, {
    estado: "todos",
  })
}

export function buildConsumiblesVentasQueryString(
  values: ConsumiblesVentasDashboardQuery,
  prefix: ConsumiblesVentasQueryScope = ""
) {
  return buildScopedQueryString(values, getConsumiblesPrefix(prefix), CONSUMIBLES_VENTAS_QUERY_KEYS, {
    estado: "todos",
  })
}
