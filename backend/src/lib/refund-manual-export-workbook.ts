import ExcelJS from 'exceljs'

export const REFUND_MANUAL_EXPORT_WORKSHEET_NAME = 'Reembolsos'
export const REFUND_MANUAL_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NUMBER_FORMAT = '#,##0.00'

const HEADER_LABELS: Record<string, string> = {
  case_id: 'ID Caso',
  created_at: 'Fecha creación',
  resolved_at: 'Fecha resolución',
  checkout_session_id: 'Checkout Session',
  flow: 'Tipo',
  status: 'Estado',
  request_origin: 'Origen',
  requested_event_name: 'Evento',
  buyer_name: 'Comprador',
  requested_amount: 'Monto solicitado',
  currency: 'Moneda',
  payment_status: 'Estado de pago',
  reconciliation_status: 'Reconciliación',
  request_reason: 'Motivo',
  external_refund_reference: 'Referencia externa',
}

const COLUMN_WIDTHS: Record<string, number> = {
  case_id: 32,
  created_at: 20,
  resolved_at: 20,
  checkout_session_id: 32,
  flow: 14,
  status: 28,
  request_origin: 24,
  requested_event_name: 28,
  buyer_name: 24,
  requested_amount: 18,
  currency: 10,
  payment_status: 18,
  reconciliation_status: 18,
  request_reason: 36,
  external_refund_reference: 28,
}

const NUMERIC_COLUMNS = new Set(['requested_amount'])

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

export function buildReembolsosExportFilename(now = new Date()) {
  return `Reembolsos_${formatDate(now)}.xlsx`
}

export function buildReembolsosCsvExportFilename(now = new Date()) {
  return `Reembolsos_${formatDate(now)}.csv`
}

export async function buildReembolsosWorkbookBuffer(rows: Array<Record<string, unknown>>, columns: string[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(REFUND_MANUAL_EXPORT_WORKSHEET_NAME)

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
