/**
 * Redondeo unificado de montos monetarios a 2 decimales.
 *
 * Usa `Number.EPSILON` para corregir errores de representación de punto flotante
 * (ej. 0.1 + 0.2 === 0.30000000000000004) antes de redondear al centavo.
 *
 * Para montos "normales" (enteros o con 2 decimales exactos) el resultado es
 * IDÉNTICO a `Number(value.toFixed(2))`; solo aporta robustez en edge cases de
 * floating point. NO cambia la lógica de cálculo de totales/descuentos.
 */
export function roundMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100
}
