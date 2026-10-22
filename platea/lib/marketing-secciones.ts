import { BarChart3, Mail, Tag, Users } from "lucide-react"

export const marketingSecciones = [
  {
    href: "/dashboard/marketing/promociones",
    label: "Promociones",
    icon: Tag,
    descripcion:
      "Creá y gestioná descuentos, códigos promocionales y ofertas especiales para tus eventos.",
  },
  {
    href: "/dashboard/marketing/segmentos",
    label: "Segmentos",
    icon: Users,
    descripcion:
      "Agrupá a tus compradores por comportamiento —VIP, activos, nuevos, en riesgo— para entender tu audiencia.",
  },
  {
    href: "/dashboard/marketing/email",
    label: "Email",
    icon: Mail,
    descripcion:
      "Creá campañas de email y automatizaciones para tus compradores: anuncios, recordatorios y recuperación.",
  },
  {
    href: "/dashboard/marketing/analitica",
    label: "Analítica",
    icon: BarChart3,
    descripcion: "Medí el rendimiento de tus campañas, conversiones y retorno de inversión.",
  },
] as const
