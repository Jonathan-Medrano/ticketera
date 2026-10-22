import { randomUUID } from 'node:crypto'
import { prisma } from './prisma'

export type TipoActividadEmpleado =
  | 'empleado_creado'
  | 'rol_cambiado'
  | 'estado_cambiado'
  | 'empleado_eliminado'
  | 'password_reseteado'
  | 'escaneo'
  | 'escaneo_fallido'
  | 'venta_consumibles'

export async function logEmpleadoActividad(params: {
  empresaId: string
  empleadoId: string
  tipo: TipoActividadEmpleado
  descripcion: string
  metadata?: Record<string, unknown>
}): Promise<void> {
  try {
    await prisma.empleadoActividad.create({
      data: {
        id: randomUUID(),
        empresa_id: params.empresaId,
        empleado_id: params.empleadoId,
        tipo: params.tipo,
        descripcion: params.descripcion,
        ...(params.metadata !== undefined ? { metadata: params.metadata as Record<string, unknown> & object } : {}),
      },
    })
  } catch {
    // Non-critical — never fail the main operation
  }
}
