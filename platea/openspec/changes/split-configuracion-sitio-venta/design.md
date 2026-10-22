# Design: Split Configuración and Sitio de Venta

## Technical Approach

Separar contratos de lectura y escritura por dominio: `Configuración` conserva cuenta/empresa interna y `Sitio de venta` pasa a un endpoint propio para branding/editorial/slug. Ambos usan PATCH parcial con whitelist explícita.

## Architecture Decisions

### Decision: Separate GET and PATCH by domain

**Choice**: `GET/PATCH /configuracion` y `GET/PATCH /sitio-venta`.
**Alternatives considered**: Separar solo PATCH.
**Rationale**: Si el GET sigue mezclado, el acoplamiento conceptual sigue vivo.

### Decision: Internal fields stay in Configuración

**Choice**: `nombre`, `email`, `admin_nombre`, `admin_apellido`, `comision_revendedor_default`, `password`.
**Alternatives considered**: Compartir parte de estos campos con Sitio de venta.
**Rationale**: El usuario ya definió ownership interno exclusivo.

### Decision: Sitio de venta owns branding/editorial/slug

**Choice**: mover `slug`, branding, layout, hero, banners, faqs y contenido público al contrato propio.
**Alternatives considered**: Mantenerlos en `/configuracion` con payload parcial.
**Rationale**: Evita que dos pantallas distintas se pisen entre sí.

## Data Flow

`Configuración UI` → `/api/configuracion` → backend `configuracion.ts` → update parcial interno

`Sitio de venta UI` → `/api/sitio-venta` → backend nuevo/segmentado → update parcial público

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `backend/src/routes/configuracion.ts` | Modify | Dejar solo config interna y password |
| `backend/src/routes/index.ts` | Modify | Registrar ruta nueva de sitio de venta |
| `backend/src/routes/` | Create/Modify | Implementar handler dedicado de sitio de venta |
| `platea/app/api/configuracion/route.ts` | Modify | Mantener contrato interno |
| `platea/app/api/sitio-venta/route.ts` | Create | Nuevo proxy dedicado |
| `platea/components/dashboard/configuracion-content.tsx` | Modify | Ajustar payload interno |
| `platea/app/(empresa)/dashboard/sitio-venta/page.tsx` / `platea/components/dashboard/sitio-venta/editor-container.tsx` | Modify | Consumir endpoint propio |
| `platea/app/(empresa)/dashboard/configuracion/page.tsx` | Modify | Leer contrato interno |
| `platea/app/(empresa)/dashboard/sitio-venta/page.tsx` | Modify | Leer contrato sitio de venta |

## Interfaces / Contracts

```ts
type ConfiguracionInternaPayload = {
  nombre: string
  email: string
  admin_nombre: string
  admin_apellido?: string | null
  comision_revendedor_default: number
}

 type SitioVentaPayload = {
   slug: string
   descripcion?: string | null
   whatsapp?: string | null
  logo_url?: string | null
  color_primario: string
  color_fondo: string
  color_texto: string
  eventos_layout: 'cards' | 'lista'
  mostrar_descripcion_home: boolean
  mostrar_tanda_activa_home: boolean
  mostrar_badge_stock_home: boolean
  mostrar_fecha_home: boolean
  mostrar_lugar_home: boolean
  mostrar_precio_home: boolean
  titulo_eventos_home?: string | null
   subtitulo_eventos_home?: string | null
   cta_eventos_home?: string | null
   banner_variant: 'blurred' | 'full'
   banners: string[]
   faqs: Array<{ pregunta: string; respuesta: string }>
 }
 ```

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Backend | PATCH interno no pisa sitio | Request real + query DB |
| Backend | PATCH sitio no pisa interno | Request real + query DB |
| Frontend | cada pantalla llama su endpoint | smoke/manual validation |

## Migration / Rollout

No migration required. Solo cambia el contrato de endpoints y el routing entre pantallas y backend. Si columnas legacy como `imagen_footer` y `footer_texto` siguen existiendo en DB, quedan fuera del contrato público/editorial.

## Open Questions

- [ ] Si conviene crear un router nuevo `sitio-venta.ts` o mantenerlo como subruta de configuración.
