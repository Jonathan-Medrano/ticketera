export type BuyerSessionUser = {
  id: string
  email: string
  name: string
  userType: "comprador"
  empresa_id: string
  empresa_slug: string
  passwordVersion: number | null
  mustChangePassword?: boolean
}

export type BuyerSessionRegistry = Record<string, BuyerSessionUser>
