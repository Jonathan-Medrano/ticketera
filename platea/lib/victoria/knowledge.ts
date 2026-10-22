// Victoria — base de conocimiento curada del asistente de ayuda del dashboard.
//
// 100% client-side, sin API ni LLM: el matching es rule-based por keywords
// (ver ./match.ts). El contenido es VERÍDICO y está fundado en PRODUCT.md y en
// features/*.md (cada tema declara su `fuente`). NO inventar features, pasos ni
// rutas: cada `cta.href` apunta a una ruta real del dashboard (validado por
// ./knowledge.test.ts).
//
// Reglas de oro respetadas (PRODUCT.md §6.3 / §7):
//  - El QR de la entrada y el QR de la barra son DOS flujos separados.
//  - Sin cashless / pulsera / saldo / wallet: el sistema es transaccional puro.
//  - El check-in NO funciona offline; los descuentos son SOLO de entradas.
//  - Comisiones: 4% entradas, 3% consumibles, sin cargo por QR, plata directo
//    a Mercado Pago al instante (la comisión de revendedor NO es por evento).

import type { Permisos } from "@/lib/permisos"

/**
 * Feature flags de la empresa, tal como llegan desde el layout del dashboard
 * (`app/(empresa)/dashboard/layout.tsx` → `/api/dashboard/features`). Se usan
 * para no sugerir temas cuya función está apagada en la cuenta.
 */
export interface FeatureFlags {
  revendedorHabilitado?: boolean
  consumiblesHabilitado?: boolean
  posMovilHabilitado?: boolean
  esPrueba?: boolean
}

export interface Topic {
  id: string
  titulo: string
  /** Variantes de cómo el usuario preguntaría: sinónimos, con/sin tilde, typos. */
  keywords: string[]
  intro: string
  pasos?: string[]
  cta?: { label: string; href: string }
  relacionados?: string[]
  /**
   * Línea de PRODUCT.md o features/*.md que funda el contenido del tema.
   * Criterio de aceptación anti-alucinación: cada intro/paso debe poder
   * señalarse a esta fuente.
   */
  fuente: string
  /**
   * Si está seteado, el tema solo se sugiere/relaciona cuando ese feature flag
   * NO está explícitamente en `false` (semántica opt-out, igual que el sidebar).
   * Si el usuario pregunta por él con el flag apagado, Victoria avisa que la
   * función no está habilitada en lugar de mandarlo a una ruta muerta.
   */
  requiereFlag?: keyof FeatureFlags
  /**
   * Permiso (RBAC) que la sección del CTA exige en el sidebar. Si está seteado y
   * el empleado NO lo tiene, Victoria responde en modo `gated` (solo el título +
   * "pediselo a un admin", NUNCA los pasos). Espejo del `permiso` del NavItem de
   * la sección en `components/dashboard/sidebar.tsx` — verificado por test
   * anti-drift. La barrera REAL es server-side (`authz.ts`); esto es UX para no
   * enseñarle a alguien cómo hacer algo que su rol no puede ejecutar.
   * Caso especial `ventas`: NO usa este campo (su gating es `canAccessVentasNav`).
   */
  requierePermiso?: keyof Permisos
  /**
   * Si es true, el tema NO aparece en los chips de sugerencias iniciales
   * (`topSuggestions`). Se usa para temas informativos/secundarios (ej.: "qué
   * hace cada rol") que sí deben ser matcheables por pregunta y enlazables como
   * `relacionados`, pero que no compiten con las acciones principales del KB.
   */
  ocultarEnSugerencias?: boolean
}

export const TOPICS: Topic[] = [
  {
    id: "crear-evento",
    titulo: "Crear un evento",
    keywords: [
      "crear evento", "crear un evento", "nuevo evento", "evento nuevo",
      "publicar evento", "publicar un evento", "armar evento", "armar un evento",
      "hacer un evento", "hacer evento", "cargar evento", "subir evento",
      "como creo un evento", "como hago un evento", "alta de evento",
      "organizar evento", "publicar fiesta", "crear fiesta", "armar fiesta",
      "evento", "eventos", "fecha", "entradas a la venta", "poner a la venta",
      "categorias de entrada", "tandas", "early bird",
    ],
    intro:
      "Te ayudo a publicar tu evento. Vas a cargar los datos, crear las categorías de entrada con su stock y dejarlo visible en tu sitio.",
    pasos: [
      "Entrá a Eventos y tocá «Nuevo evento».",
      "Cargá los datos: nombre, fecha (única, varias fechas o pase) y lugar.",
      "Creá las categorías de entrada (General, VIP, Early Bird…), cada una con su precio y su stock independiente.",
      "Si querés precios escalonados, sumá tandas/oleadas de venta.",
      "Guardá y publicá: el evento queda visible en tu sitio de venta.",
    ],
    cta: { label: "Ir a crear evento", href: "/dashboard/eventos/nuevo" },
    relacionados: ["sitio-venta", "cobros"],
    fuente: "PRODUCT.md §6.1",
    requierePermiso: "ver_eventos",
  },
  {
    id: "sitio-venta",
    titulo: "Tu sitio de venta",
    keywords: [
      "sitio de venta", "sitio venta", "mi sitio", "sitio", "pagina", "página",
      "pagina web", "web", "mi web", "subdominio", "dominio", "marca", "branding",
      "logo", "colores", "color primario", "personalizar", "configurar marca",
      "home", "galeria", "galería", "fotos", "faq", "link de venta", "link de compra",
      "donde venden", "donde compran", "sitio publico", "sitio público",
    ],
    intro:
      "Tu sitio de venta es la web pública con TU marca: el comprador compra dentro de tu productora, en tu propio subdominio, no en una plataforma de terceros.",
    pasos: [
      "Entrá a Sitio de venta.",
      "Configurá tu marca: logo, color primario, fondo y textos.",
      "Armá el home: hero, listado de eventos, galería de fotos, FAQ y datos de contacto (WhatsApp, email de soporte).",
      "Guardá: los cambios quedan online en tu subdominio.",
    ],
    cta: { label: "Ir a Sitio de venta", href: "/sitio-venta/editor" },
    relacionados: ["crear-evento", "cobros"],
    fuente: "PRODUCT.md §6.5",
    requierePermiso: "editar_configuracion",
  },
  {
    id: "cobros",
    titulo: "Conectar Mercado Pago",
    keywords: [
      "cobros", "cobrar", "como cobro", "donde va la plata", "recibir plata",
      "recibir pagos", "mercado pago", "mercadopago", "mp", "conectar mp",
      "conectar mercado pago", "vincular mercado pago", "vincular cuenta",
      "cuenta de cobro", "pagos", "metodo de pago", "cuando cobro",
      "acreditacion", "acreditación", "cuando me pagan", "cuando llega la plata",
    ],
    intro:
      "Para vender necesitás conectar tu cuenta de Mercado Pago. La plata de cada venta entra directo a tu cuenta, al instante — TICKETERA solo retiene su comisión.",
    pasos: [
      "Entrá a Cobros.",
      "Conectá tu cuenta de Mercado Pago (te lleva a MP para autorizar).",
      "Cuando queda «lista para vender», ya podés cobrar entradas y consumibles.",
      "Cada venta acredita directo en tu Mercado Pago al instante; no hay liquidación a días.",
    ],
    cta: { label: "Ir a Cobros", href: "/dashboard/cobros" },
    relacionados: ["comisiones", "crear-evento"],
    fuente: "PRODUCT.md §5 · features/pagos-checkout.md",
    requierePermiso: "editar_configuracion",
  },
  {
    id: "comisiones",
    titulo: "Comisiones de TICKETERA",
    keywords: [
      "comision", "comisión", "comisiones", "cuanto cobran", "cuanto cobra",
      "cuanto me cobran", "cuanto me sacan", "cuanto cuesta", "que cobran",
      "costo", "precio", "tarifa", "cargo", "fee", "cargo por qr", "cargo de servicio",
      "porcentaje", "cuanto es la comision",
    ],
    intro:
      "TICKETERA cobra 4% sobre entradas y 3% sobre consumibles. Sin costo fijo y sin cargo por QR emitido.",
    pasos: [
      "4% sobre las entradas vendidas.",
      "3% sobre los consumibles (barra).",
      "Sin cargo por QR y sin cuota fija.",
      "La comisión de entradas la podés absorber vos o trasladarla al comprador como cargo de servicio.",
      "La plata va directo a tu Mercado Pago al instante; TICKETERA solo retiene su comisión.",
    ],
    cta: { label: "Ir a Comisiones", href: "/dashboard/comisiones" },
    relacionados: ["cobros", "revendedores"],
    fuente: "PRODUCT.md §5",
    requierePermiso: "ver_recaudacion",
  },
  {
    id: "barra",
    titulo: "Vender en la barra",
    keywords: [
      "barra", "barras", "pos", "punto de venta",
      "vender en barra", "vender consumibles", "vender tragos", "vender bebidas",
      "canje", "canjear", "redencion", "redención", "entregar pedido",
      "entregar consumible", "cobrar en barra", "vender en la barra",
      "qr de barra", "qr barra", "escanear pedido", "escanear consumible",
    ],
    intro:
      "La barra vive en la misma plataforma que las entradas, con control de stock. Vendés presencial o canjeás los pedidos que se compraron online. Ojo: el QR de la barra es DISTINTO al de la entrada — son dos flujos separados.",
    pasos: [
      "Para vender en el momento, entrá a «Vender en barra» (efectivo, tarjeta o transferencia): el stock baja en vivo.",
      "Si el cliente compró online, recibió un QR por barra: lo escaneás y entregás el pedido (canje), con stock al instante.",
      "Recordá: el QR de la barra no es el de la entrada — son flujos separados.",
      "¿Todavía no cargaste el catálogo ni las barras? Hacé primero ese setup en Consumibles.",
    ],
    cta: { label: "Ir a vender en barra", href: "/dashboard/consumibles/vender" },
    relacionados: ["consumibles-setup", "escanear", "comisiones"],
    fuente: "features/consumibles-barra.md · PRODUCT.md §6.3",
    requiereFlag: "consumiblesHabilitado",
    requierePermiso: "vender_consumibles",
  },
  {
    id: "consumibles-setup",
    titulo: "Cargar consumibles y crear barras",
    keywords: [
      "catalogo", "catálogo", "consumibles", "consumible", "cargar consumibles",
      "crear barra", "crear barras", "armar barra", "armar barras", "configurar barra",
      "configurar consumibles", "alta de consumible", "agregar producto",
      "cargar productos", "productos de barra", "stock de barra", "stock barra",
      "cargar stock", "precios de barra", "setup de barra", "preparar la barra",
      "que vende cada barra", "asignar consumibles", "tragos", "bebidas",
      "reposicion", "reposición",
    ],
    intro:
      "Antes de vender necesitás armar el setup de la barra: cargás tu catálogo de consumibles y creás las barras del evento, cada una con su propio stock y precios. Después sí podés vender o canjear pedidos. (El QR de la barra es distinto al de la entrada.)",
    pasos: [
      "Entrá a Consumibles y cargá tu catálogo: nombre, precio, descripción e imagen.",
      "Creá las barras del evento desde Barras; cada barra maneja su propio stock.",
      "Asigná qué consumibles vende cada barra y cargá el stock por barra.",
      "Activá alertas de reposición para que te avise cuando una barra se está quedando sin stock.",
      "Con el catálogo y las barras listas, ya podés vender en barra o entregar lo comprado online.",
    ],
    cta: { label: "Ir a Consumibles", href: "/dashboard/consumibles" },
    relacionados: ["barra", "comisiones"],
    fuente: "features/consumibles-barra.md · PRODUCT.md §6.3",
    requiereFlag: "consumiblesHabilitado",
    requierePermiso: "ver_consumibles",
  },
  {
    id: "escanear",
    titulo: "Escanear entradas (control de acceso)",
    keywords: [
      "escanear", "escaneo", "escaneá", "leer qr", "control de acceso", "acceso",
      "puerta", "check in", "checkin", "check-in", "validar entrada", "validar qr",
      "ingreso", "entrada usada", "camara", "cámara", "codigo corto", "código corto",
      "aforo", "cuantos entraron", "lista de acceso", "scanner", "escaner", "escáner",
    ],
    intro:
      "El control de acceso corre en el navegador del celu, sin instalar nada. Escaneás el QR de cada entrada y el sistema evita que se use dos veces. Necesita conexión: sin internet no marca.",
    pasos: [
      "Entrá a Escanear y abrí la cámara del celular.",
      "Escaneá el QR de cada entrada: si ya se usó, lo rechaza al instante (no se puede escanear dos veces).",
      "Si la cámara no abre o el QR está dañado, usá el modo manual por código corto.",
      "Seguí el aforo en vivo: ingresadas vs. pendientes y % de check-in.",
    ],
    cta: { label: "Ir a Escanear", href: "/dashboard/escanear" },
    relacionados: ["barra"],
    fuente: "features/checkin-qr.md · PRODUCT.md §6.4",
    requierePermiso: "escanear",
  },
  {
    id: "equipo",
    titulo: "Invitar y gestionar el equipo",
    keywords: [
      "equipo", "mi equipo", "empleado", "empleados", "staff", "personal",
      "invitar", "invitar equipo", "agregar empleado", "agregar al equipo",
      "sumar persona", "sumar a alguien", "dar de alta usuario", "alta de empleado",
      "crear usuario", "nuevo usuario", "gestionar equipo", "administrar equipo",
      "como agrego a alguien", "como invito", "darle acceso a alguien",
      "cargar empleados", "miembro del equipo", "integrante", "mozos", "cajeros",
    ],
    intro:
      "A tu equipo lo das de alta vos desde el dashboard: no hay registro público de empleados. Creás cada usuario, le asignás un rol y queda operando solo lo que ese rol permite, con su propio login (nunca comparte tu cuenta de empresa).",
    pasos: [
      "Entrá a Equipo y tocá «Nuevo» para dar de alta a una persona.",
      "Cargá sus datos y asignale un rol: el rol define qué puede ver y hacer.",
      "La persona entra con su propio usuario y contraseña, separado de tu cuenta de empresa.",
      "Editá o dá de baja a cualquier integrante cuando lo necesites.",
    ],
    cta: { label: "Ir a Equipo", href: "/dashboard/equipo" },
    relacionados: ["roles"],
    fuente: "features/auth-onboarding.md · PRODUCT.md §6.7",
    requierePermiso: "ver_equipo",
  },
  {
    id: "roles",
    titulo: "Roles y permisos",
    keywords: [
      "rol", "roles", "permiso", "permisos", "rbac", "que puede hacer cada uno",
      "que ve cada uno", "niveles de acceso", "perfil", "perfiles",
      "permisos de empleado", "restringir", "limitar acceso", "quien puede",
      "dar permisos", "sacar permisos", "administrador", "rol personalizado",
      "configurar permisos", "permisos del equipo", "que puede ver",
      "vendedor", "operador", "rol de puerta", "rol de barra",
    ],
    intro:
      "Los roles definen qué ve y qué puede hacer cada persona del equipo. Usás los roles que ya vienen (puerta, vendedor, barra, operador, administrador) o creás uno propio con permisos a medida. Por seguridad, nadie puede otorgar más permisos de los que tiene.",
    pasos: [
      "Entrá a Roles para ver los roles predefinidos y los permisos de cada uno.",
      "Creá un rol personalizado si necesitás una combinación puntual de permisos.",
      "Asigná el rol a cada integrante desde Equipo.",
      "Tranquila/o: cada acción se revalida en el servidor, así nadie escala sus propios permisos.",
    ],
    cta: { label: "Ir a Roles", href: "/dashboard/roles" },
    relacionados: ["roles-explicados", "equipo"],
    fuente: "features/auth-onboarding.md · PRODUCT.md §6.7",
    requierePermiso: "ver_roles",
  },
  {
    id: "reembolsos",
    titulo: "Reembolsos",
    keywords: [
      "reembolso", "reembolsos", "reembolsar", "devolucion", "devolución",
      "devolver plata", "devolver dinero", "devolver la entrada", "reintegro",
      "cancelar compra", "anular venta", "plata para atras", "plata atras",
      "pedido de reembolso", "arrepentimiento", "refund", "como devuelvo",
      "devolverle al cliente", "le quiero devolver", "reembolso automatico",
      "reembolso manual",
    ],
    intro:
      "Gestionás los reembolsos desde el panel, sin salir a Mercado Pago. Hay dos modos: manual (vos aprobás o rechazás cada caso) y automático (se resuelve solo al vencer la ventana de arrepentimiento). El dinero se devuelve directamente a Mercado Pago del comprador.",
    pasos: [
      "Entrá a Reembolsos para ver los pedidos pendientes de resolución.",
      "Modo manual: revisás cada caso con detalle del comprador y la compra, y decidís aprobar o rechazar.",
      "Modo automático: si está configurada una ventana de arrepentimiento (SLA), el sistema aprueba o rechaza solo cuando vence el plazo.",
      "Los reembolsos aprobados se procesan vía Mercado Pago y el saldo se devuelve al método de pago original del comprador.",
      "Cada caso queda con auditoría completa: quién actuó, cuándo y qué pasó.",
    ],
    cta: { label: "Ir a Reembolsos", href: "/dashboard/reembolsos" },
    relacionados: ["cobros", "comisiones"],
    fuente: "features/pagos-checkout.md · PRODUCT.md §6.2",
    requierePermiso: "gestionar_reembolsos",
  },
  {
    id: "ventas",
    titulo: "Ver ventas y facturación",
    keywords: [
      "ventas", "mis ventas", "ver ventas", "detalle de ventas", "resumen de ventas",
      "facturacion", "facturación", "facturado", "cuanto facture", "cuanto vendi",
      "cuanto gane", "cuanto lleve vendido", "recaudacion", "recaudación",
      "ingresos", "reporte", "reportes", "kpi", "kpis", "metricas", "métricas",
      "estadisticas", "estadísticas", "numeros del negocio", "balance",
      "exportar ventas", "como veo mis ventas", "donde veo lo vendido",
    ],
    intro:
      "Tenés dos lugares para mirar el negocio: Inicio te da el resumen rápido (entradas vendidas, facturación, conversión, próximo evento y últimas ventas) y Ventas te deja entrar al detalle transacción por transacción, comparar eventos y exportar a Excel/CSV.",
    pasos: [
      "Abrí Inicio para el panorama general: entradas vendidas, facturación y conversión.",
      "Entrá a Ventas para el detalle, transacción por transacción.",
      "Compará el rendimiento entre eventos para ver qué funcionó mejor.",
      "Exportá lo que necesites a Excel o CSV para tu contabilidad.",
    ],
    cta: { label: "Ir a Ventas", href: "/dashboard/ventas" },
    relacionados: ["comisiones", "crear-evento"],
    fuente: "PRODUCT.md §6.8",
  },
  {
    id: "revendedores",
    titulo: "Gestionar revendedores",
    keywords: [
      "revendedor", "revendedores", "revendedora", "revendedoras", "reventa",
      "revender", "gestionar revendedores", "administrar revendedores",
      "programa de revendedores", "comision de revendedor", "comisión de revendedor",
      "comision revendedor", "liquidacion", "liquidación", "liquidaciones",
      "payout", "payouts", "tickets fisicos", "tickets físicos", "tickets preimpresos",
      "entradas fisicas", "entradas físicas", "anular ticket", "anulacion de ticket",
      "anulación de ticket", "lote de tickets", "asignar tickets",
      "cuanto le pago al revendedor", "ventas del revendedor", "alta de revendedor",
    ],
    intro:
      "Acá gestionás tus revendedores DESDE la empresa (no es el panel propio de cada revendedor). Definís su comisión, seguís lo que vende cada uno y liquidás lo que les corresponde. La comisión se configura a nivel empresa y la podés ajustar por revendedor — NUNCA es «por evento».",
    pasos: [
      "Entrá a Revendedores y dá de alta a cada revendedor del equipo.",
      "Definí la comisión: por defecto a nivel empresa, ajustable por revendedor (no hay comisión por evento).",
      "Cada revendedor tiene su propio panel con sus ventas y su comisión acumulada, con filtros por período y evento — eso lo ve la persona, vos lo gestionás desde acá.",
      "Si usás tickets físicos / preimpresos, asignás lotes por revendedor y controlás la anulación de los que no se vendieron.",
      "Cuando liquidás, exportás el detalle de payouts a Excel o CSV para pagarles.",
    ],
    cta: { label: "Ir a Revendedores", href: "/dashboard/revendedores" },
    relacionados: ["comisiones", "roles-explicados"],
    fuente: "PRODUCT.md §6.6 · §7",
    requiereFlag: "revendedorHabilitado",
    requierePermiso: "gestionar_revendedores",
  },
  {
    id: "compradores",
    titulo: "Ver compradores",
    keywords: [
      "compradores", "comprador", "mis compradores", "ver compradores", "lista de compradores",
      "quien compro", "quién compró", "buscar comprador", "buscar por email",
      "historial de compras", "historial del comprador", "cuantos compradores",
      "cuántos compradores", "base de compradores", "clientes", "mis clientes",
      "cliente frecuente", "comprador recurrente", "tasa de recurrencia",
      "ticket promedio", "cuanto gasta", "cuánto gasta", "top comprador",
      "exportar compradores", "datos del comprador", "email del comprador",
    ],
    intro:
      "En Compradores tenés el historial completo de quién compró: podés buscar por nombre o email, ver cuánto gastó cada persona, qué eventos compró y cuál es la tasa de recurrencia de tu base.",
    pasos: [
      "Entrá a Compradores para ver la lista con nombre, email, total gastado y última compra.",
      "Buscá por nombre o email para encontrar a un comprador específico.",
      "Filtrá por evento para ver quién compró en cada fecha.",
      "En el resumen global vas a ver métricas como tasa de recurrencia, ticket promedio y cuántos compradores tienen email.",
      "Si necesitás exportar para tu CRM o para enviar campañas, usá el botón de exportación.",
    ],
    cta: { label: "Ir a Compradores", href: "/dashboard/compradores" },
    relacionados: ["ventas", "marketing"],
    fuente: "PRODUCT.md §6.8",
    requierePermiso: "ver_compradores",
  },
  {
    id: "configuracion",
    titulo: "Configuración de la cuenta",
    keywords: [
      "configuracion", "configuración", "config", "ajustes", "ajuste de cuenta",
      "datos de empresa", "nombre de empresa", "cambiar nombre", "cambiar subdominio",
      "subdominio", "slug", "cuotas", "cuota", "maximo de cuotas", "máximo de cuotas",
      "cuotas de mercado pago", "cuotas mp", "installments",
      "deshabilitar sitio", "ocultar sitio", "visibilidad del sitio",
      "comision por ventas", "cargo de servicio", "fee de entradas",
      "fee de consumibles", "porcentaje de cargo", "nombre del admin", "email de admin",
    ],
    intro:
      "Desde Configuración ajustás los datos de tu empresa (nombre, email, slug), la comisión que le transferís al comprador, el límite de cuotas de Mercado Pago y si el sitio público está visible o no.",
    pasos: [
      "Entrá a Configuración para ver y editar el nombre, email y subdominio de tu empresa.",
      "Configurá la comisión que trasladan al comprador como «cargo de servicio»: podés absorberla vos o que la pague el comprador.",
      "Ajustá el máximo de cuotas habilitadas en Mercado Pago (1 = solo contado).",
      "Si necesitás pausar las ventas temporalmente, deshabilitá el sitio público desde acá.",
    ],
    cta: { label: "Ir a Configuración", href: "/dashboard/configuracion" },
    relacionados: ["cobros", "sitio-venta"],
    fuente: "PRODUCT.md §5",
    requierePermiso: "ver_configuracion",
  },
  {
    id: "pos",
    titulo: "Punto de venta (POS móvil)",
    keywords: [
      "pos", "punto de venta", "pos movil", "pos móvil", "venta en mano",
      "cobrar en mano", "vender en mano", "cobrar presencial", "venta presencial",
      "emitir qr", "emitir entrada", "generar entrada", "entrada en mano",
      "cobrar y emitir", "cobrar y dar entrada", "caja", "maquina de venta",
      "vender fuera de linea", "vender offline", "entrada manual",
      "punto de cobro", "tablet de venta",
    ],
    intro:
      "El POS móvil te permite cobrar entradas en mano y emitir el QR al instante, desde el celu o tablet. Ideal para venta en boletería, en la puerta o en eventos sin reserva online previa.",
    pasos: [
      "Entrá a Punto de venta y seleccioná el evento.",
      "Elegí la categoría de entrada y la cantidad.",
      "Cobrá: el sistema genera el QR al instante y lo puede escanear en la puerta.",
      "Cada venta queda registrada en Ventas y descuenta el stock de la categoría.",
    ],
    cta: { label: "Ir a Punto de venta", href: "/dashboard/pos" },
    relacionados: ["crear-evento", "escanear"],
    fuente: "PRODUCT.md §6.1",
    requiereFlag: "posMovilHabilitado",
  },
  {
    id: "marketing",
    titulo: "Marketing y promociones",
    keywords: [
      "marketing", "promocion", "promoción", "promociones", "descuento", "descuentos",
      "codigo de descuento", "código de descuento", "codigo promo", "código promo",
      "cupon", "cupón", "cupones", "carrito abandonado", "carritos abandonados",
      "email marketing", "mailing", "enviar email", "campana", "campaña",
      "segmento", "segmentos", "segmentacion", "segmentación",
      "pixel", "meta pixel", "facebook pixel", "ga4", "google analytics",
      "gtm", "tag manager", "trackear", "tracking", "analitica", "analítica",
    ],
    intro:
      "Desde Marketing gestionás los códigos de descuento, los segmentos de compradores y la integración de herramientas de analítica y tracking (GA4, Meta Pixel, GTM) para medir tus campañas.",
    pasos: [
      "Entrá a Marketing para ver los códigos de descuento activos y crear nuevos (% o monto fijo).",
      "Revisá los segmentos: automáticos (ej: compradores de un evento) y manuales para campañas puntuales.",
      "Activá el tracking pegando tu ID de GA4, Meta Pixel o GTM: los eventos de compra se envían solos.",
      "Con segmentos armados podés exportar los emails y hacer campañas desde tu herramienta habitual.",
    ],
    cta: { label: "Ir a Marketing", href: "/dashboard/marketing" },
    relacionados: ["compradores", "ventas"],
    fuente: "PRODUCT.md §6.8",
    requierePermiso: "ver_marketing",
  },
  {
    id: "reconciliacion",
    titulo: "Reconciliación de pagos",
    keywords: [
      "reconciliacion", "reconciliación", "conciliacion", "conciliación",
      "conciliar pagos", "estado de pagos", "pagos pendientes", "pagos aprobados",
      "pagos cancelados", "pagos rechazados", "contabilidad", "estado de cobros",
      "cobros pendientes", "cobros rechazados", "seguimiento de pagos",
      "auditoria de pagos", "auditoría de pagos", "transacciones", "historial de pagos",
      "pago revertido", "pago en proceso", "checkout", "checkouts",
    ],
    intro:
      "En Reconciliación tenés el historial completo de pagos transacción por transacción, con su estado (aprobado, pendiente, cancelado, reembolsado). Es la fuente de verdad para cruzar con tu Mercado Pago.",
    pasos: [
      "Entrá a Reconciliación para ver todas las transacciones con su estado y monto.",
      "Filtrá por evento, estado o rango de fechas para acotar lo que buscás.",
      "Cada fila muestra la referencia del pago, el monto neto y el estado actual.",
      "Exportá a Excel o CSV para cruzar contra tu cuenta de Mercado Pago o tu contabilidad.",
    ],
    cta: { label: "Ir a Reconciliación", href: "/dashboard/reconciliacion" },
    relacionados: ["ventas", "reembolsos"],
    fuente: "PRODUCT.md §6.8",
    requierePermiso: "ver_recaudacion",
  },
  {
    id: "mi-panel-revendedor",
    titulo: "Mi panel de revendedor",
    keywords: [
      "mi panel", "panel de revendedor", "mis ventas", "cuanto vendi", "cuánto vendí",
      "mi comision", "mi comisión", "cuanto gane", "cuánto gané", "mis ganancias",
      "mi link", "link de venta", "link personal", "mi enlace", "compartir link",
      "como comparten mis clientes", "cómo compran mis clientes",
      "mi stock", "entradas disponibles", "que puedo vender", "qué puedo vender",
      "cuanto llevo vendido", "resumen de ventas", "mis estadisticas",
    ],
    intro:
      "Acá ves todo lo tuyo: cuánto vendiste, tu comisión acumulada, tu link personal de venta y el stock disponible por categoría. La plata la cobra el cliente directo (Mercado Pago); vos recibís tu comisión cuando la empresa la liquida.",
    pasos: [
      "En el inicio de tu panel ves el resumen de ventas y tu comisión acumulada hasta hoy.",
      "Tu link de venta es único: compartilo con tus clientes para que compren directamente.",
      "Filtrá por período o evento para ver el detalle de qué vendiste y cuándo.",
      "Revisá el stock disponible por categoría antes de salir a vender, para no ofrecer entradas sin stock.",
    ],
    cta: { label: "Ir a mi panel", href: "/revendedor" },
    relacionados: ["tickets-fisicos"],
    fuente: "PRODUCT.md §6.6",
    ocultarEnSugerencias: false,
  },
  {
    id: "tickets-fisicos",
    titulo: "Mis tickets físicos",
    keywords: [
      "tickets fisicos", "tickets físicos", "entradas fisicas", "entradas físicas",
      "ticket impreso", "entrada impresa", "ticket preimpreso", "lote de tickets",
      "tickets asignados", "anular ticket", "anulacion", "anulación",
      "no vendi todos", "no vendí todos", "me sobraron tickets", "devolver ticket",
      "ticket sin usar", "ticket que no vendiste", "voided", "anular entrada fisica",
    ],
    intro:
      "Si la empresa te asignó lotes de tickets físicos / preimpresos, acá los gestionás: ves cuántos te asignaron, cuántos vendiste y podés anular los que no se usaron.",
    pasos: [
      "Entrá a Tickets físicos para ver los lotes que te asignaron.",
      "Cada lote muestra la cantidad total, las vendidas y las disponibles.",
      "Si te sobraron tickets o hay uno que no se usó, podés anularlo desde acá.",
      "La empresa ve desde su panel los lotes asignados y las anulaciones que hagas.",
    ],
    cta: { label: "Ir a Tickets físicos", href: "/revendedor/tickets-fisicos" },
    relacionados: ["mi-panel-revendedor"],
    fuente: "PRODUCT.md §6.6",
    ocultarEnSugerencias: false,
  },
  {
    id: "roles-explicados",
    titulo: "Qué hace cada rol",
    keywords: [
      "que hace cada rol", "qué hace cada rol", "que puede hacer cada rol",
      "que ve cada rol", "qué ve cada rol", "diferencia entre roles",
      "para que sirve cada rol", "roles predefinidos", "rol puerta", "rol vendedor",
      "rol operador", "rol admin", "rol administrador", "rol barra", "rol revendedor",
      "que es el rol de puerta", "que es un operador", "que hace un vendedor",
      "que hace el barra", "que permisos tiene cada rol", "explicame los roles",
      "que rol le doy", "que rol pongo", "cual rol elijo", "qué rol elijo",
    ],
    intro:
      "Cada rol predefinido viene con un set de permisos pensado para una tarea. Te explico qué hace cada uno para que elijas bien al dar de alta a alguien (después podés crear roles a medida en Roles).",
    pasos: [
      "Puerta: solo control de acceso. Escanea entradas en la entrada del evento, nada más.",
      "Vendedor: ve eventos, entradas y compradores para acompañar la venta; no toca configuración ni plata.",
      "Operador: además de ver, crea y edita eventos y entradas, con precios y totales; ideal para producción.",
      "Barra: opera la barra: ve consumibles, ajusta stock, vende y canjea pedidos.",
      "Administrador: acceso amplio a casi todo (equipo, roles, recaudación, reembolsos, marketing).",
      "Revendedor: NO entra al dashboard de empresa; tiene su propio panel donde ve solo sus ventas y su comisión.",
    ],
    cta: { label: "Ir a Roles", href: "/dashboard/roles" },
    relacionados: ["equipo", "roles"],
    fuente: "PRODUCT.md §6.7",
    ocultarEnSugerencias: true,
  },
]

/** Lookup por id, para resolver `relacionados`. */
export const TOPIC_BY_ID: Record<string, Topic> = Object.fromEntries(
  TOPICS.map((t) => [t.id, t]),
)
