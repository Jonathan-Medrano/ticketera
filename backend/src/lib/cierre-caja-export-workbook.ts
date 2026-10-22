import ExcelJS from 'exceljs'

export const CIERRE_CAJA_EXPORT_WORKSHEET_NAME = 'Cierre de caja'
export const CIERRE_CAJA_EXPORT_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const NUMBER_FORMAT_MONEY = '#,##0.00'
const NUMBER_FORMAT_INT = '#,##0'

const HEADER_LABELS: Record<string, string> = {
  fecha: 'Fecha',
  entradas_vendidas: 'Entradas vendidas',
  entradas_bruto: 'Entradas bruto',
  consumibles_vendidos: 'Consumibles vendidos',
  consumibles_bruto: 'Consumibles bruto',
  descuentos_count: 'Descuentos (cant.)',
  descuentos_monto: 'Descuentos monto',
  refunds_count: 'Reembolsos (cant.)',
  refunds_monto: 'Reembolsos monto',
  total_bruto: 'Total bruto',
  comision_platea: 'Comisión',
  neto_empresa: 'Neto empresa',
}

const COLUMN_WIDTHS: Record<string, number> = {
  fecha: 13,
  entradas_vendidas: 16,
  entradas_bruto: 16,
  consumibles_vendidos: 18,
  consumibles_bruto: 16,
  descuentos_count: 16,
  descuentos_monto: 16,
  refunds_count: 16,
  refunds_monto: 16,
  total_bruto: 16,
  comision_platea: 16,
  neto_empresa: 16,
}

const MONEY_COLUMNS = new Set([
  'entradas_bruto',
  'consumibles_bruto',
  'descuentos_monto',
  'refunds_monto',
  'total_bruto',
  'comision_platea',
  'neto_empresa',
])

const INTEGER_COLUMNS = new Set([
  'entradas_vendidas',
  'consumibles_vendidos',
  'descuentos_count',
  'refunds_count',
])

function formatDateForFilename(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function buildCierreCajaExportFilename(options: { desde?: string; hasta?: string; now?: Date } = {}) {
  const now = options.now ?? new Date()
  const range =
    options.desde && options.hasta
      ? `${options.desde}_${options.hasta}`
      : `ultimos-30-dias-${formatDateForFilename(now)}`
  return `Cierre_Caja_${range}.xlsx`
}

export type CierreCajaRow = {
  fecha: string
  entradas_vendidas: number
  entradas_bruto: number
  consumibles_vendidos: number
  consumibles_bruto: number
  descuentos_count: number
  descuentos_monto: number
  refunds_count: number
  refunds_monto: number
  total_bruto: number
  comision_platea: number
  neto_empresa: number
}

export type CierreCajaTotals = {
  total_bruto: number
  comision_platea: number
  neto_empresa: number
  refunds_monto: number
  descuentos_monto: number
}

const COLUMN_ORDER: Array<keyof CierreCajaRow> = [
  'fecha',
  'entradas_vendidas',
  'entradas_bruto',
  'consumibles_vendidos',
  'consumibles_bruto',
  'descuentos_count',
  'descuentos_monto',
  'refunds_count',
  'refunds_monto',
  'total_bruto',
  'comision_platea',
  'neto_empresa',
]

export async function buildCierreCajaWorkbookBuffer(rows: CierreCajaRow[], totals: CierreCajaTotals | null) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Ticketera'
  workbook.created = new Date()

  const worksheet = workbook.addWorksheet(CIERRE_CAJA_EXPORT_WORKSHEET_NAME)

  worksheet.columns = COLUMN_ORDER.map((column) => ({
    key: column,
    header: HEADER_LABELS[column] ?? column,
    width: COLUMN_WIDTHS[column] ?? 14,
    style: MONEY_COLUMNS.has(column)
      ? { numFmt: NUMBER_FORMAT_MONEY, alignment: { horizontal: 'right' as const } }
      : INTEGER_COLUMNS.has(column)
        ? { numFmt: NUMBER_FORMAT_INT, alignment: { horizontal: 'right' as const } }
        : undefined,
  }))

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMN_ORDER.length },
  }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF000000' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE5E7EB' } }
  headerRow.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
  headerRow.height = 22

  // Data rows
  for (const row of rows) worksheet.addRow(row)

  // Fila TOTAL al final (solo si hay data)
  if (totals && rows.length > 0) {
    const totalRow = worksheet.addRow({
      fecha: 'TOTAL',
      descuentos_monto: totals.descuentos_monto,
      refunds_monto: totals.refunds_monto,
      total_bruto: totals.total_bruto,
      comision_platea: totals.comision_platea,
      neto_empresa: totals.neto_empresa,
    })
    totalRow.font = { bold: true }
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
    totalRow.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
