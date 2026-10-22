import ExcelJS from 'exceljs'

export const ESCANEAR_EXPORT_WORKSHEET_NAME = 'Escaneos'
export const ESCANEAR_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

export const ESCANEAR_EXPORT_COLUMNS = [
  'fecha_escaneo',
  'hora_escaneo',
  'comprador_nombre',
  'comprador_apellido',
  'comprador_dni',
  'categoria',
  'evento',
  'clave_corta',
  'escaneado_por',
] as const

const HEADER_LABELS: Record<string, string> = {
  fecha_escaneo: 'Fecha',
  hora_escaneo: 'Hora',
  comprador_nombre: 'Nombre',
  comprador_apellido: 'Apellido',
  comprador_dni: 'DNI',
  categoria: 'Categoría',
  evento: 'Evento',
  clave_corta: 'Clave corta',
  escaneado_por: 'Escaneado por',
}

const COLUMN_WIDTHS: Record<string, number> = {
  fecha_escaneo: 14,
  hora_escaneo: 10,
  comprador_nombre: 22,
  comprador_apellido: 22,
  comprador_dni: 14,
  categoria: 22,
  evento: 28,
  clave_corta: 14,
  escaneado_por: 22,
}

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

export function buildEscanearExportFilename(now = new Date()) {
  return `Escaneos_${formatDate(now)}.xlsx`
}

export function buildEscanearCsvExportFilename(now = new Date()) {
  return `Escaneos_${formatDate(now)}.csv`
}

export async function buildEscanearWorkbookBuffer(rows: Array<Record<string, unknown>>, columns: string[]) {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(ESCANEAR_EXPORT_WORKSHEET_NAME)

  worksheet.columns = columns.map((column) => ({
    key: column,
    header: HEADER_LABELS[column] ?? column,
    width: COLUMN_WIDTHS[column] ?? 18,
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
