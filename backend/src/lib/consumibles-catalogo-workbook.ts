import ExcelJS from 'exceljs'

export const CATALOGO_EXPORT_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const CATALOGO_HEADER_LABELS: Record<string, string> = {
  nombre: 'Nombre',
  descripcion: 'Descripción',
  precio: 'Precio',
  estado: 'Estado',
  archived_at: 'Desactivado el',
  created_at: 'Creado el',
}

const CATALOGO_COLUMN_WIDTHS: Record<string, number> = {
  nombre: 30,
  descripcion: 40,
  precio: 14,
  estado: 12,
  archived_at: 20,
  created_at: 20,
}

const CATALOGO_COLUMNS = ['nombre', 'descripcion', 'precio', 'estado', 'archived_at', 'created_at']
const CATALOGO_NUMERIC_COLUMNS = new Set(['precio'])
const CATALOGO_NUMBER_FORMAT = '#,##0.00'

function formatDateDDMMYYYY(value: unknown): string {
  if (!value) return ''
  const d = new Date(value as string)
  if (isNaN(d.getTime())) return ''
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const year = d.getFullYear()
  return `${day}/${month}/${year}`
}

export async function buildConsumiblesCatalogoWorkbookBuffer(rows: Record<string, unknown>[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  const worksheet = workbook.addWorksheet('Catálogo Consumibles')

  worksheet.columns = CATALOGO_COLUMNS.map((col) => ({
    key: col,
    header: CATALOGO_HEADER_LABELS[col] ?? col,
    width: CATALOGO_COLUMN_WIDTHS[col] ?? 18,
    style: CATALOGO_NUMERIC_COLUMNS.has(col)
      ? { numFmt: CATALOGO_NUMBER_FORMAT, alignment: { horizontal: 'right' as const } }
      : undefined,
  }))

  worksheet.views = [{ state: 'frozen', ySplit: 1 }]
  worksheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: CATALOGO_COLUMNS.length } }

  const headerRow = worksheet.getRow(1)
  headerRow.font = { bold: true, color: { argb: 'FF000000' } }
  headerRow.alignment = { vertical: 'middle', horizontal: 'left' }
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD3D3D3' } }
  headerRow.border = { bottom: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
  headerRow.height = 22

  for (const row of rows) {
    worksheet.addRow({
      nombre: row.nombre ?? '',
      descripcion: row.descripcion ?? '',
      precio: Number(row.precio ?? 0),
      estado: Number(row.activo) === 1 ? 'Activo' : 'Inactivo',
      archived_at: formatDateDDMMYYYY(row.archived_at),
      created_at: formatDateDDMMYYYY(row.created_at),
    })
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}
