import ExcelJS from 'exceljs'

export const ENTRADAS_EXPORT_WORKSHEET_NAME = 'Entradas'
export const ENTRADAS_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export const ENTRADAS_EXPORT_CSV_CONTENT_TYPE = 'text/csv; charset=utf-8'
const ENTRADAS_EXPORT_NUMBER_FORMAT = '#,##0.00'

const ENTRADAS_EXPORT_HEADER_LABELS: Record<string, string> = {
  fecha_compra: 'Fecha compra',
  estado: 'Estado',
  reembolsada: 'Reembolsada',
  evento: 'Evento',
  comprador_email: 'Email comprador',
  comprador_dni: 'DNI comprador',
  precio_pagado: 'Precio pagado',
  comision: 'Comisión',
  neto_empresa_amount: 'Neto empresa',
  total_reembolsado: 'Total reembolsado',
  total_sin_reembolso: 'Total sin reembolso',
  total_final: 'Total final',
  neto_total: 'Neto total',
}

const ENTRADAS_EXPORT_COLUMN_WIDTHS: Record<string, number> = {
  fecha_compra: 20,
  estado: 14,
  reembolsada: 16,
  evento: 28,
  comprador_email: 28,
  comprador_dni: 18,
  precio_pagado: 16,
  comision: 14,
  neto_empresa_amount: 18,
  total_reembolsado: 18,
  total_sin_reembolso: 21,
  total_final: 16,
  neto_total: 16,
}

const ENTRADAS_EXPORT_NUMERIC_COLUMNS = new Set(['precio_pagado', 'comision', 'neto_empresa_amount', 'total_reembolsado', 'total_sin_reembolso', 'total_final', 'neto_total'])

function formatEntradasExportDate(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })

  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function buildEntradasExportFilename(now = new Date()) {
  return `Entradas_Resumen_${formatEntradasExportDate(now)}.xlsx`
}

export function buildEntradasCsvExportFilename(now = new Date()) {
  return `Entradas_Resumen_${formatEntradasExportDate(now)}.csv`
}

export async function buildEntradasWorkbookBuffer(rows: Array<Record<string, unknown>>, columns: string[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(ENTRADAS_EXPORT_WORKSHEET_NAME)

  worksheet.columns = columns.map((column) => ({
    key: column,
    header: ENTRADAS_EXPORT_HEADER_LABELS[column] ?? column,
    width: ENTRADAS_EXPORT_COLUMN_WIDTHS[column] ?? 18,
    style: ENTRADAS_EXPORT_NUMERIC_COLUMNS.has(column)
      ? { numFmt: ENTRADAS_EXPORT_NUMBER_FORMAT, alignment: { horizontal: 'right' as const } }
      : undefined,
  }))

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: Math.max(columns.length, 1) },
  }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF000000' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE5E7EB' },
  }
  headerRow.border = {
    bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } },
  }
  headerRow.height = 22

  for (const row of rows) {
    worksheet.addRow(row)
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
