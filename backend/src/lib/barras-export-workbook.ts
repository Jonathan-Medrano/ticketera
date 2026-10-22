import ExcelJS from 'exceljs'

export const BARRAS_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

// ─── Export A: Resumen de barras por evento ────────────────────────────────

const RESUMEN_HEADER_LABELS: Record<string, string> = {
  barra_nombre: 'Barra',
  activa: 'Estado',
  total_items: 'Total Items',
  items_activos: 'Items Activos',
  sin_stock: 'Sin Stock',
  low_stock: 'Stock Bajo (≤20%)',
  archived_at: 'Archivada el',
}

const RESUMEN_COLUMN_WIDTHS: Record<string, number> = {
  barra_nombre: 25,
  activa: 12,
  total_items: 13,
  items_activos: 14,
  sin_stock: 12,
  low_stock: 18,
  archived_at: 20,
}

const RESUMEN_COLUMNS = ['barra_nombre', 'activa', 'total_items', 'items_activos', 'sin_stock', 'low_stock', 'archived_at']
const RESUMEN_NUMERIC_COLUMNS = new Set(['total_items', 'items_activos', 'sin_stock', 'low_stock'])

export async function buildBarrasResumenWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Resumen Barras')

  worksheet.columns = RESUMEN_COLUMNS.map((col) => ({
    key: col,
    header: RESUMEN_HEADER_LABELS[col] ?? col,
    width: RESUMEN_COLUMN_WIDTHS[col] ?? 18,
    style: RESUMEN_NUMERIC_COLUMNS.has(col)
      ? { alignment: { horizontal: 'right' as const } }
      : undefined,
  }))

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: RESUMEN_COLUMNS.length } }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF000000' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
  headerRow.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
  headerRow.height = 22

  for (const row of rows) {
    worksheet.addRow({
      barra_nombre: row.barra_nombre ?? '',
      activa: Number(row.activa) === 1 ? 'Activa' : 'Inactiva',
      total_items: Number(row.total_items ?? 0),
      items_activos: Number(row.items_activos ?? 0),
      sin_stock: Number(row.sin_stock ?? 0),
      low_stock: Number(row.low_stock ?? 0),
      archived_at: row.archived_at ? String(row.archived_at).slice(0, 10) : '',
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

// ─── Export B: Detalle de stock por barra ──────────────────────────────────

const STOCK_HEADER_LABELS: Record<string, string> = {
  consumible_nombre: 'Consumible',
  descripcion: 'Descripción',
  precio_base: 'Precio Base',
  precio_override: 'Precio Override',
  stock_inicial: 'Stock Inicial',
  stock_actual: 'Stock Actual',
  pct_consumido: '% Consumido',
  activo: 'Activo',
}

const STOCK_COLUMN_WIDTHS: Record<string, number> = {
  consumible_nombre: 25,
  descripcion: 30,
  precio_base: 14,
  precio_override: 16,
  stock_inicial: 14,
  stock_actual: 14,
  pct_consumido: 14,
  activo: 10,
}

const STOCK_COLUMNS = [
  'consumible_nombre',
  'descripcion',
  'precio_base',
  'precio_override',
  'stock_inicial',
  'stock_actual',
  'pct_consumido',
  'activo',
]
const STOCK_NUMERIC_COLUMNS = new Set(['precio_base', 'precio_override', 'stock_inicial', 'stock_actual'])

export async function buildBarraStockWorkbookBuffer(rows: Record<string, unknown>[], barraName: string): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(`Stock - ${barraName}`.slice(0, 31))

  worksheet.columns = STOCK_COLUMNS.map((col) => ({
    key: col,
    header: STOCK_HEADER_LABELS[col] ?? col,
    width: STOCK_COLUMN_WIDTHS[col] ?? 18,
    style: STOCK_NUMERIC_COLUMNS.has(col)
      ? { alignment: { horizontal: 'right' as const } }
      : undefined,
  }))

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: STOCK_COLUMNS.length } }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF000000' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
  headerRow.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
  headerRow.height = 22

  for (const row of rows) {
    worksheet.addRow({
      consumible_nombre: row.consumible_nombre ?? '',
      descripcion: row.descripcion ?? '',
      precio_base: Number(row.precio_base ?? 0),
      precio_override: row.precio_override != null ? Number(row.precio_override) : '',
      stock_inicial: Number(row.stock_inicial ?? 0),
      stock_actual: Number(row.stock_actual ?? 0),
      pct_consumido: `${Number(row.pct_consumido ?? 0)}%`,
      activo: Number(row.activo) === 1 ? 'Sí' : 'No',
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
