import ExcelJS from 'exceljs'

export const CONSUMIBLES_EXPORT_WORKSHEET_NAME = 'Consumibles'
export const CONSUMIBLES_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const CONSUMIBLES_EXPORT_NUMBER_FORMAT = '#,##0.00'

const HEADER_LABELS: Record<string, string> = {
  fecha_compra: 'Fecha compra',
  estado: 'Estado',
  reembolsada: 'Reembolsada',
  origen: 'Origen',
  evento: 'Evento',
  barra: 'Barra',
  total: 'Monto',
  neto_empresa_amount: 'Neto empresa',
  delivered_amount: 'Monto final',
  reembolso_parcial: 'Reembolso parcial',
  total_reembolsado: 'Total reembolsado',
  neto_total: 'Neto total',
}

const COLUMN_WIDTHS: Record<string, number> = {
  fecha_compra: 20,
  estado: 16,
  reembolsada: 16,
  origen: 16,
  evento: 28,
  barra: 24,
  total: 16,
  neto_empresa_amount: 18,
  delivered_amount: 16,
  reembolso_parcial: 18,
  total_reembolsado: 18,
  neto_total: 16,
}

const NUMERIC_COLUMNS = new Set(['total', 'neto_empresa_amount', 'delivered_amount', 'total_reembolsado', 'neto_total'])

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

export function buildConsumiblesExportFilename(now = new Date()) {
  return `Consumibles_Resumen_${formatDate(now)}.xlsx`
}

export async function buildConsumiblesWorkbookBuffer(rows: Array<Record<string, unknown>>, columns: string[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(CONSUMIBLES_EXPORT_WORKSHEET_NAME)

  worksheet.columns = columns.map((column) => ({
    key: column,
    header: HEADER_LABELS[column] ?? column,
    width: COLUMN_WIDTHS[column] ?? 18,
    style: NUMERIC_COLUMNS.has(column)
      ? { numFmt: CONSUMIBLES_EXPORT_NUMBER_FORMAT, alignment: { horizontal: 'right' as const } }
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
