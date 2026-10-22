import { puedeHacer, type Permisos } from "@/lib/permisos"

type TicketEstado = "pendiente" | "canjeado" | "cancelado" | "resuelto_parcial"

export function canUseConsumiblesPermission(
  permiso: keyof Permisos,
  permisos?: Permisos,
  esEmpleado?: boolean
) {
  return puedeHacer(permiso, esEmpleado ?? false, permisos)
}

export function canCancelConsumiblesTicket(
  estado: TicketEstado,
  permisos?: Permisos,
  esEmpleado?: boolean
) {
  return estado === "pendiente" && canUseConsumiblesPermission("gestionar_consumibles", permisos, esEmpleado)
}

export function getConsumiblesTicketActions(
  estado: TicketEstado,
  permisos?: Permisos,
  esEmpleado?: boolean
) {
  return {
    canViewDetail: true,
    canCancel: canCancelConsumiblesTicket(estado, permisos, esEmpleado),
  }
}
