# Design: Accessible Tooltip System

## Technical Approach

Crear un primitive `Tooltip` en `components/ui`, montado sobre `radix-ui` ya presente en `package.json`, y una abstracción `IconAction` para controles icon-only. El objetivo es reemplazar `title` dispersos y normalizar `aria-label` + tooltip desktop, manteniendo el lenguaje visual de overlays existentes (`Dialog`, `DropdownMenu`, `Select`) y sin tocar todavía tooltips informativos de texto largo ni charts de `recharts`.

## Architecture Decisions

| Decisión | Opciones | Elección y tradeoff |
|---|---|---|
| Primitive base | Helper ad-hoc por feature / `components/ui/tooltip.tsx` | `components/ui/tooltip.tsx`. Sigue el patrón real de `dialog.tsx` y `dropdown-menu.tsx`. Evita duplicación; no extrae todavía una capa shared de floating styles. |
| Abstracción icon-only | Extender `Button` / wrapper dedicado | Wrapper dedicado `components/ui/icon-action.tsx`. `Button` ya soporta `asChild`; mezclar reglas tooltip/accesibilidad dentro de `Button` contaminaría usos con texto visible. |
| Coarse pointer | Tooltip siempre activo / gating por media query | Gating por `matchMedia("(hover: hover) and (pointer: fine)")`. Tradeoff: hook client-only, pero cumple spec y evita hover UI fantasma en touch. |
| Disabled | Tooltip directo sobre botón disabled / wrapper habilitado | Wrapper no disabled (`span` con `tabIndex=0` sólo si hay explicación). Tradeoff: un nodo extra, pero respeta que el botón nativo disabled no sea trigger. |

## Data Flow

`IconAction(label, disabledReason?)`
  -> aplica `aria-label=label`
  -> decide trigger base (`Button`, `Link`, o child via `asChild`)
  -> si desktop fine pointer: envuelve con `TooltipTrigger` + `TooltipContent`
  -> si disabled con explicación: wrapper focusable -> tooltip; control interno queda `disabled`
  -> si coarse pointer: renderiza sólo control accesible, sin tooltip

## File Changes

| File | Action | Description |
|---|---|---|
| `components/ui/tooltip.tsx` | Create | Primitive base con `Provider`, `Trigger`, `Content`, `Portal`; estilos `bg-popover`, `text-popover-foreground`, `ring-foreground/10`, `shadow-md`. |
| `components/ui/icon-action.tsx` | Create | Abstracción icon-only con `label` obligatorio, soporte `variant`, `size`, `asChild`, `href`/`Link`, disabled wrapper y tooltip por defecto. |
| `components/dashboard/sidebar.tsx` | Modify | Reemplazar `title` en estado colapsado desktop y acciones compactas; no mostrar tooltip en mobile. |
| `components/tenant/tenant-theme-toggle.tsx` | Modify | Migrar `title` a nuevo sistema manteniendo `aria-label`. |
| `components/tenant/tenant-navbar.tsx` | Modify | Aplicar a toggle, carrito, mis tickets y logout icon-only. |
| `components/tenant/tenant-home.tsx` | Modify | Igual que `tenant-navbar` para la variante home. |
| `components/dashboard/{eventos,roles,consumibles,consumibles-promociones,consumibles-barras,consumibles-ventas,entradas,equipo,revendedores,compradores}-content.tsx` | Modify | Primera ola sobre paginación icon-only y acciones de fila compactas. |

## Interfaces / Contracts

```tsx
type IconActionProps = {
  label: string
  tooltip?: React.ReactNode // default: label
  disabled?: boolean
  disabledReason?: React.ReactNode
  asChild?: boolean
} & VariantProps<typeof buttonVariants>
```

Reglas:
- `label` es obligatorio y siempre se refleja en `aria-label`.
- Si hay texto visible, NO usar `IconAction`.
- `tooltip` custom sólo para casos donde el texto visual de ayuda difiere del accessible name; no abrir esa necesidad en primera ola.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Unit | `IconAction` exige `label`; coarse pointer no renderiza tooltip; disabled wrapper conserva `disabled` | RTL sobre `components/ui` |
| Integration | Sidebar colapsado, tenant topbar y paginación/listados muestran tooltip desktop y no mobile | Tests de componentes clave |
| Manual | Escape, focus/blur, click activation, links `asChild` | QA desktop + mobile responsive |

## Migration / Rollout

Primera ola exacta:
- `components/dashboard/sidebar.tsx`: labels ocultos al colapsar.
- `components/tenant/tenant-navbar.tsx`, `components/tenant/tenant-home.tsx`, `components/tenant/tenant-theme-toggle.tsx`: topbar icon-only.
- Listados dashboard con icon-only/paginación: `eventos-content.tsx`, `roles-content.tsx`, `consumibles-content.tsx`, `consumibles-promociones-content.tsx`, `consumibles-barras-content.tsx`, `consumibles-ventas-content.tsx`, `entradas-content.tsx`, `equipo-content.tsx`, `revendedores-content.tsx`, `compradores-content.tsx`.

Quedan afuera en esta ola: `checkout-content.tsx` (tooltip explicativo largo), emails “click para copiar”, charts `recharts`, y botones con texto visible como `Ver detalle` en compradores.

## Open Questions

- [ ] Confirmar si `revendedores-content.tsx` debe corregir también ausencia actual de `aria-label` en acciones icon-only dentro de esta misma ola; técnicamente conviene que sí.
