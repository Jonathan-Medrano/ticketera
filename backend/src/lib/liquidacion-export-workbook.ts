import ExcelJS from 'exceljs'

export const LIQUIDACION_EXPORT_WORKSHEET_NAME = 'Liquidación'
export const LIQUIDACION_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
const LIQUIDACION_EXPORT_CURRENCY_FORMAT = '#,##0.00'
const LIQUIDACION_EXPORT_DATE_FORMAT = 'yyyy-mm-dd'

export interface LiquidacionRow {
  evento_id: string
  evento_nombre: string
  estado_evento: string
  evento_alta: string
  entradas_vendidas: number
  entradas_canceladas: number
  entradas_bruto: number
  entradas_comision_platea: number
  entradas_neto_empresa: number
  consumibles_vendidos: number
  consumibles_cancelados: number
  consumibles_bruto: number
  consumibles_comision_platea: number
  consumibles_neto_empresa: number
  total_bruto: number
  total_comision_platea: number
  total_neto_empresa: number
}

const HEADER_LABELS: Record<keyof LiquidacionRow, string> = {
  evento_id: 'ID Evento',
  evento_nombre: 'Evento',
  estado_evento: 'Estado',
  evento_alta: 'Alta',
  entradas_vendidas: 'Ent. vendidas',
  entradas_canceladas: 'Ent. canceladas',
  entradas_bruto: 'Ent. bruto',
  entradas_comision_platea: 'Ent. comisión',
  entradas_neto_empresa: 'Ent. neto empresa',
  consumibles_vendidos: 'Cons. vendidos',
  consumibles_cancelados: 'Cons. cancelados',
  consumibles_bruto: 'Cons. bruto',
  consumibles_comision_platea: 'Cons. comisión',
  consumibles_neto_empresa: 'Cons. neto empresa',
  total_bruto: 'Total bruto',
  total_comision_platea: 'Total comisión',
  total_neto_empresa: 'Total neto empresa',
}

const COLUMN_WIDTHS: Record<keyof LiquidacionRow, number> = {
  evento_id: 38,
  evento_nombre: 30,
  estado_evento: 12,
  evento_alta: 14,
  entradas_vendidas: 14,
  entradas_canceladas: 16,
  entradas_bruto: 14,
  entradas_comision_platea: 16,
  entradas_neto_empresa: 18,
  consumibles_vendidos: 14,
  consumibles_cancelados: 16,
  consumibles_bruto: 14,
  consumibles_comision_platea: 16,
  consumibles_neto_empresa: 18,
  total_bruto: 14,
  total_comision_platea: 16,
  total_neto_empresa: 18,
}

const CURRENCY_COLUMNS = new Set<keyof LiquidacionRow>([
  'entradas_bruto',
  'entradas_comision_platea',
  'entradas_neto_empresa',
  'consumibles_bruto',
  'consumibles_comision_platea',
  'consumibles_neto_empresa',
  'total_bruto',
  'total_comision_platea',
  'total_neto_empresa',
])

const INTEGER_COLUMNS = new Set<keyof LiquidacionRow>([
  'entradas_vendidas',
  'entradas_canceladas',
  'consumibles_vendidos',
  'consumibles_cancelados',
])

const COLUMN_ORDER: Array<keyof LiquidacionRow> = [
  'evento_id',
  'evento_nombre',
  'estado_evento',
  'evento_alta',
  'entradas_vendidas',
  'entradas_canceladas',
  'entradas_bruto',
  'entradas_comision_platea',
  'entradas_neto_empresa',
  'consumibles_vendidos',
  'consumibles_cancelados',
  'consumibles_bruto',
  'consumibles_comision_platea',
  'consumibles_neto_empresa',
  'total_bruto',
  'total_comision_platea',
  'total_neto_empresa',
]

function formatLiquidacionExportDate(now: Date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Argentina/Buenos_Aires',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]))
  return `${parts.year}-${parts.month}-${parts.day}`
}

export function buildLiquidacionExportFilename(now = new Date()) {
  return `liquidacion-eventos-${formatLiquidacionExportDate(now)}.xlsx`
}

export async function buildLiquidacionWorkbook(rows: LiquidacionRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet(LIQUIDACION_EXPORT_WORKSHEET_NAME)

  worksheet.columns = COLUMN_ORDER.map((key) => {
    if (CURRENCY_COLUMNS.has(key)) {
      return {
        key,
        header: HEADER_LABELS[key],
        width: COLUMN_WIDTHS[key],
        style: { numFmt: LIQUIDACION_EXPORT_CURRENCY_FORMAT, alignment: { horizontal: 'right' as const } },
      }
    }
    if (key === 'evento_alta') {
      return {
        key,
        header: HEADER_LABELS[key],
        width: COLUMN_WIDTHS[key],
        style: { numFmt: LIQUIDACION_EXPORT_DATE_FORMAT },
      }
    }
    if (INTEGER_COLUMNS.has(key)) {
      return {
        key,
        header: HEADER_LABELS[key],
        width: COLUMN_WIDTHS[key],
        style: { alignment: { horizontal: 'right' as const } },
      }
    }
    return {
      key,
      header: HEADER_LABELS[key],
      width: COLUMN_WIDTHS[key],
    }
  })

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = {
    from: { row: 1, column: 1 },
    to: { row: 1, column: COLUMN_ORDER.length },
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

  // Totals row
  if (rows.length > 0) {
    const totalsRow = worksheet.addRow({
      evento_id: 'TOTAL',
      evento_nombre: '',
      estado_evento: '',
      evento_alta: '',
      entradas_vendidas: rows.reduce((sum, r) => sum + r.entradas_vendidas, 0),
      entradas_canceladas: rows.reduce((sum, r) => sum + r.entradas_canceladas, 0),
      entradas_bruto: rows.reduce((sum, r) => sum + r.entradas_bruto, 0),
      entradas_comision_platea: rows.reduce((sum, r) => sum + r.entradas_comision_platea, 0),
      entradas_neto_empresa: rows.reduce((sum, r) => sum + r.entradas_neto_empresa, 0),
      consumibles_vendidos: rows.reduce((sum, r) => sum + r.consumibles_vendidos, 0),
      consumibles_cancelados: rows.reduce((sum, r) => sum + r.consumibles_cancelados, 0),
      consumibles_bruto: rows.reduce((sum, r) => sum + r.consumibles_bruto, 0),
      consumibles_comision_platea: rows.reduce((sum, r) => sum + r.consumibles_comision_platea, 0),
      consumibles_neto_empresa: rows.reduce((sum, r) => sum + r.consumibles_neto_empresa, 0),
      total_bruto: rows.reduce((sum, r) => sum + r.total_bruto, 0),
      total_comision_platea: rows.reduce((sum, r) => sum + r.total_comision_platea, 0),
      total_neto_empresa: rows.reduce((sum, r) => sum + r.total_neto_empresa, 0),
    })
    totalsRow.font = { bold: true }
    totalsRow.fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFF3F4F6' },
    }
    totalsRow.border = {
      top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
    }
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
