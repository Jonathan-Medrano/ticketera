import ExcelJS from 'exceljs'
import { escapeSpreadsheetFormula } from './csv-escape'

export const COMPRADORES_EXPORT_WORKSHEET_NAME = 'Compradores'
export const COMPRADORES_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const NUMBER_FORMAT = '#,##0.00'

const HEADER_LABELS: Record<string, string> = {
  fecha_registro: 'Fecha registro',
  comprador: 'Comprador',
  email: 'Email',
  dni: 'DNI',
  total_gastado_entradas: 'Total gastado entradas',
  total_gastado_consumibles: 'Total gastado consumibles',
  neto_empresa_total: 'Neto empresa',
}

const COLUMN_WIDTHS: Record<string, number> = {
  fecha_registro: 20,
  comprador: 28,
  email: 30,
  dni: 16,
  total_gastado_entradas: 18,
  total_gastado_consumibles: 20,
  neto_empresa_total: 16,
}

const NUMERIC_COLUMNS = new Set(['total_gastado_entradas', 'total_gastado_consumibles', 'neto_empresa_total'])

// User-controlled free-text fields — defense in depth against spreadsheet formula injection
const FORMULA_SANITIZED_COLUMNS = new Set(['comprador', 'email', 'dni'])

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

export function buildCompradoresExportFilename(now = new Date()) {
  return `Compradores_Resumen_${formatDate(now)}.xlsx`
}

export function buildCompradoresCsvExportFilename(now = new Date()) {
  return `Compradores_Resumen_${formatDate(now)}.csv`
}

export async function buildCompradoresWorkbookBuffer(rows: Array<Record<string, unknown>>, columns: string[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(COMPRADORES_EXPORT_WORKSHEET_NAME)

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

  for (const row of rows) {
    const safeRow: Record<string, unknown> = { ...row }
    for (const column of FORMULA_SANITIZED_COLUMNS) {
      if (column in safeRow) safeRow[column] = escapeSpreadsheetFormula(safeRow[column])
    }
    worksheet.addRow(safeRow)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
