/**
 * CSV formula injection prevention helper.
 * RFC 4180 quoting + defense against spreadsheet formula injection.
 *
 * Formula injection: when a cell value starts with =, +, -, @, \t or \r
 * Excel/LibreOffice interpret it as a formula. Prefixing with a single quote
 * forces the cell to be treated as text.
 *
 * Use `safeCsvCell` for all user-controlled text fields (nombres, emails, etc.).
 * Numeric/date values already serialized as numbers do NOT need the prefix.
 */

const FORMULA_INJECTION_RE = /^[=+\-@\t\r]/

/**
 * Prefix formula-starter characters with an apostrophe so spreadsheet apps
 * (Excel, LibreOffice, Google Sheets) render the value as plain text instead
 * of evaluating it as a formula. Shared by CSV and XLSX (ExcelJS) export paths.
 * - Null/undefined → empty string
 */
export function escapeSpreadsheetFormula(value: unknown): string {
  const raw = value == null ? '' : String(value)
  return FORMULA_INJECTION_RE.test(raw) ? `'${raw}` : raw
}

/**
 * Escape a value for safe CSV output.
 * - Null/undefined → empty string
 * - Formula-injection chars at start → prefixed with ' (apostrophe)
 * - Contains comma, double-quote or newline → wrapped in double quotes (RFC 4180)
 */
export function safeCsvCell(value: unknown): string {
  const safe = escapeSpreadsheetFormula(value)

  // RFC 4180: wrap in quotes if contains comma, double-quote or newline
  if (/[",\n\r]/.test(safe)) {
    return `"${safe.replace(/"/g, '""')}"`
  }

  return safe
}
