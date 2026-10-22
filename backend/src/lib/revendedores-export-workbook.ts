import ExcelJS from 'exceljs'

export const REVENDEDORES_EXPORT_WORKSHEET_NAME = 'Revendedores'
export const REVENDEDORES_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NUMBER_FORMAT = '#,##0.00'

const HEADER_LABELS: Record<string, string> = {
  revendedor: 'Revendedor',
  fecha_alta: 'Fecha alta',
  ventas_totales: 'Ventas totales',
  ganancia_total: 'Ganancia total',
  ganancia_neta: 'Ganancia neta',
}

const COLUMN_WIDTHS: Record<string, number> = {
  revendedor: 28,
  fecha_alta: 20,
  ventas_totales: 16,
  ganancia_total: 18,
  ganancia_neta: 18,
}

const NUMERIC_COLUMNS = new Set(['ventas_totales', 'ganancia_total', 'ganancia_neta'])

function formatDate(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function buildRevendedoresExportFilename(now = new Date()) {
  return `Revendedores_Resumen_${formatDate(now)}.xlsx`
}

export function buildRevendedoresCsvExportFilename(now = new Date()) {
  return `Revendedores_Resumen_${formatDate(now)}.csv`
}

export async function buildRevendedoresWorkbookBuffer(rows: Array<Record<string, unknown>>, columns: string[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(REVENDEDORES_EXPORT_WORKSHEET_NAME)

  worksheet.columns = columns.map((column) => ({
    key: column,
    header: HEADER_LABELS[column] ?? column,
    width: COLUMN_WIDTHS[column] ?? 18,
    style: NUMERIC_COLUMNS.has(column)
      ? { numFmt: NUMBER_FORMAT, alignment: { horizontal: 'right' as const } }
      : undefined,
  }))

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(columns.length, 1) } }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF000000' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
  headerRow.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
  headerRow.height = 22

  for (const row of rows) worksheet.addRow(row)

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
