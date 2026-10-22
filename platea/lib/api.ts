type ApiErrorPayload = {
  error?: string
}

async function parseJsonSafe(response: Response) {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const response = await fetch(input, init)
  const payload = await parseJsonSafe(response)

  if (!response.ok) {
    const message = (payload as ApiErrorPayload | null)?.error ?? "Error inesperado de API"
    throw new Error(message)
  }

  return payload as T
}

function extractList<T>(payload: unknown, legacyKeys: string[] = []): T[] {
  if (Array.isArray(payload)) return payload as T[]
  if (!payload || typeof payload !== "object") return []

  const record = payload as Record<string, unknown>
  if (Array.isArray(record.data)) return record.data as T[]

  for (const key of legacyKeys) {
    if (Array.isArray(record[key])) return record[key] as T[]
  }

  return []
}

function extractId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null
  const record = payload as Record<string, unknown>

  if (typeof record.id === "string") return record.id
  if (record.data && typeof record.data === "object" && record.data !== null) {
    const nested = record.data as Record<string, unknown>
    if (typeof nested.id === "string") return nested.id
  }

  return null
}

export interface BarraDto {
  id: string
  nombre: string
  activa: number
  buyer_consumible_refunds_enabled?: number
  evento_id: string
  empresa_id: string
  total_items?: number
  items_activos?: number
  sin_stock_items?: number
  low_stock_items?: number
}

export interface BarraStockDto {
  id: string
  consumible_id: string
  nombre: string
  descripcion?: string
  categoria?: string | null
  imagen_url?: string | null
  precio_base: number
  precio_override: number | null
  stock_inicial: number
  stock_actual: number
  stock_ilimitado: boolean
  agotado: boolean
  activo: number
  restock_alerta_id?: string | null
  restock_pendiente?: number
}

export interface ConsumibleDto {
  id: string
  nombre: string
  precio: number
  descripcion?: string
  imagen_url?: string | null
  activo?: number
}

type ConsumiblesListOptions = {
  page?: number
  pageSize?: number
  busqueda?: string
  estado?: "todos" | "activos" | "inactivos"
  sortBy?: string
  sortDir?: "asc" | "desc"
  incluirInactivos?: boolean
}

export interface CoberturaBarraDto {
  id: string
  nombre: string
  activa: number
  stock_id: string | null
  asignado: number
  stock_inicial: number
  stock_actual: number
  stock_ilimitado: boolean
  agotado: boolean
  precio_override: number | null
  stock_activo: number
}

export interface CoberturaConsumibleDto {
  consumible: ConsumibleDto
  barras: CoberturaBarraDto[]
}

export const consumiblesApi = {
  async list(options?: ConsumiblesListOptions): Promise<ConsumibleDto[]> {
    const params = new URLSearchParams()
    if (options?.page) params.set("page", String(options.page))
    if (options?.pageSize) params.set("pageSize", String(options.pageSize))
    if (options?.busqueda) params.set("busqueda", options.busqueda)
    if (options?.estado && options.estado !== "todos") params.set("estado", options.estado)
    if (options?.sortBy) params.set("sortBy", options.sortBy)
    if (options?.sortDir) params.set("sortDir", options.sortDir)
    if (options?.incluirInactivos) params.set("incluir_inactivos", "1")
    const suffix = params.toString() ? `?${params.toString()}` : ""

    const payload = await request<unknown>(`/api/consumibles${suffix}`)
    return extractList<ConsumibleDto>(payload, ["consumibles"])
  },

  async getBarras(eventoId: string, options?: { soloActivas?: boolean }): Promise<BarraDto[]> {
    const params = new URLSearchParams({ evento_id: eventoId })
    if (options?.soloActivas) params.set("solo_activas", "1")

    const payload = await request<unknown>(`/api/consumibles/barras?${params.toString()}`)
    return extractList<BarraDto>(payload, ["barras"])
  },

  async createBarra(body: { evento_id: string; nombre: string; buyer_consumible_refunds_enabled?: boolean | number }): Promise<string> {
    const payload = await request<unknown>("/api/consumibles/barras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })

    const id = extractId(payload)
    if (!id) throw new Error("No se recibió id de la barra creada")
    return id
  },

  async updateBarra(id: string, body: { nombre?: string; activa?: number | boolean; buyer_consumible_refunds_enabled?: number | boolean }) {
    return request<{ ok: true }>(`/api/consumibles/barras/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  },

  async deleteBarra(id: string) {
    return request<{ ok: true }>(`/api/consumibles/barras/${id}`, { method: "DELETE" })
  },

  async getBarraStock(barraId: string, options?: { soloActivos?: boolean }): Promise<BarraStockDto[]> {
    const params = new URLSearchParams()
    if (options?.soloActivos) params.set("solo_activos", "1")
    const suffix = params.toString() ? `?${params.toString()}` : ""

    const payload = await request<unknown>(`/api/consumibles/barras/${barraId}/stock${suffix}`)
    return extractList<BarraStockDto>(payload, ["stock", "items"])
  },

  async addBarraStock(
    barraId: string,
    body: { consumible_id: string; stock_inicial: number; precio_override: number | null; stock_ilimitado?: boolean }
  ) {
    return request<{ ok: true }>(`/api/consumibles/barras/${barraId}/stock`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  },

  async updateBarraStock(
    barraId: string,
    body: { items: Array<{ consumible_id: string; stock_inicial: number; precio_override: number | null; stock_ilimitado?: boolean }> }
  ) {
    return request<{ ok: true }>(`/api/consumibles/barras/${barraId}/stock`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  },

  async requestRestock(barraId: string, stockId: string, nota?: string) {
    return request<{ ok: true; data: { id: string } }>(
      `/api/consumibles/barras/${barraId}/stock/${stockId}/restock`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota: nota ?? null }),
      }
    )
  },

  async resolveRestock(barraId: string, stockId: string, alertaId: string) {
    return request<{ ok: true }>(
      `/api/consumibles/barras/${barraId}/stock/${stockId}/restock/${alertaId}`,
      {
        method: "PATCH",
      }
    )
  },

  async setItemDisponibilidad(
    barraId: string,
    consumibleId: string,
    body: { stock_ilimitado?: boolean; agotado?: boolean }
  ) {
    return request<{ ok: true }>(
      `/api/consumibles/barras/${barraId}/items/${consumibleId}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )
  },

  async getCobertura(consumibleId: string, eventoId: string): Promise<CoberturaConsumibleDto> {
    const payload = await request<{ data?: CoberturaConsumibleDto }>(
      `/api/consumibles/${consumibleId}/barras?evento_id=${eventoId}`
    )

    if (!payload?.data) throw new Error("No se recibió la cobertura del consumible")
    return payload.data
  },

  async assignToBarras(
    consumibleId: string,
    body: {
      evento_id: string
      barra_ids?: string[]
      todas?: boolean
      stock_inicial: number
      precio_override: number | null
      stock_ilimitado?: boolean
    }
  ) {
    return request<{ ok: true; data: { assigned: number } }>(
      `/api/consumibles/${consumibleId}/barras/asignaciones`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }
    )
  },

  async saveConsumible(body: {
    id?: string
    nombre: string
    descripcion: string | null
    categoria: string | null
    tipo: string
    precio: number
    imagen_url: string | null
  }) {
    const url = body.id ? `/api/consumibles/${body.id}` : "/api/consumibles"
    const method = body.id ? "PUT" : "POST"
    const payload = await request<unknown>(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body.id ? body : { ...body, id: undefined }),
    })

    return {
      payload,
      id: extractId(payload),
    }
  },

  async deleteConsumible(id: string) {
    return request<{ ok: true }>(`/api/consumibles/${id}`, { method: "DELETE" })
  },

  async toggleConsumible(id: string, activo: boolean) {
    return request<{ ok: true }>(`/api/consumibles/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ activo: activo ? 1 : 0 }),
    })
  },
}
