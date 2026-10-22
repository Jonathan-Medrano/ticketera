"use client"

import type { Permisos } from "@/lib/permisos"
import RolFormContent from "@/components/dashboard/rol-form-content"

type RoleDetail = {
  id: string
  nombre: string
  slug: string
  es_predefinido: number
  permisos: string | Partial<Permisos>
}

interface Props {
  rol: RoleDetail
  permisos?: Permisos
  esEmpleado?: boolean
}

export default function RolDetalleContent({ rol }: Props) {
  return <RolFormContent modo="ver" rol={rol} />
}
