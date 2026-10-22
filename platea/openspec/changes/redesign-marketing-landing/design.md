# Design: Redesign Marketing Landing

## Technical Approach

La landing pública seguirá entrando por `app/page.tsx` → `app/(marketing)/homepage.tsx`. La diferencia es arquitectónica: `homepage.tsx` debe dejar de renderizar bloques inline con CTAs propios y pasar a ser un **compositor server-side** de primitives existentes. La integración realista es:

1. `Navbar` abre la experiencia y mantiene navegación/CTA global.
2. `LandingHero` reemplaza el hero actual y absorbe la acción principal mediante `MarketingActions`.
3. `OperationsStrip` introduce rápido la promesa operativa.
4. `LandingSection` estructura las secciones de venta, gestión y control sin repetir layout.
5. Un único bloque de cierre reutiliza `MarketingActions` con el mismo contrato visual.

Esto consolida narrativa B2B de ticketing + operación, reutiliza tokens ya presentes en `app/globals.css` y elimina la fragmentación actual entre `HeroButtons`, `ComoFuncionaButton` y `CtaButton`.

## Architecture Decisions

| Decisión | Alternativas consideradas | Elección | Rationale |
|---|---|---|---|
| Orquestación de homepage | Reescribir toda la landing en un componente nuevo / mantener inline la composición vieja | Mantener `app/(marketing)/homepage.tsx` como entrypoint y compositor | Es la ruta activa real; reduce riesgo y aprovecha primitives existentes sin romper el wiring actual. |
| Fuente única de CTA | Dejar CTAs por sección / centralizar en `MarketingActions` | `MarketingActions` como contrato único de acciones | Evita duplicación, corrige destinos inconsistentes y garantiza jerarquía primaria/secundaria estable. |
| Estructura de secciones | Cards y bloques ad hoc por sección / primitive base compartida | `LandingSection` como wrapper para encabezado, spacing y ancho | Mejora consistencia visual, accesibilidad semántica y mantenimiento sin sobre-abstracting el contenido. |
| Estado del navbar | Rehacer navbar desde cero / iterar sobre el actual | Conservar `Navbar` y alinearlo al nuevo flujo | Ya está más cerca del objetivo que el resto; sólo necesita ajustar anchors, CTA y URL pública consistente. |

## Data Flow

```text
app/page.tsx
  -> app/(marketing)/homepage.tsx
     -> Navbar
     -> LandingHero
        -> MarketingActions
     -> OperationsStrip
     -> LandingSection("venta")
     -> LandingSection("gestión")
     -> LandingSection("control operativo")
     -> LandingSection("cta final")
        -> MarketingActions
```

Flujo de acciones:

- Usuario sin sesión:
  - primary CTA → `/login?tab=registro`
  - secondary CTA → ancla interna válida (ej. `#producto` o `#operacion`)
- Usuario con sesión:
  - primary CTA → `/dashboard`
  - secondary CTA → sitio público vía `buildTenantPublicUrl`

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/redesign-marketing-landing/design.md` | Modify | Actualiza el diseño al estado real verificado. |
| `app/(marketing)/homepage.tsx` | Modify | Reemplaza composición inline vieja por composición de primitives existentes. |
| `components/marketing/landing-hero.tsx` | Modify | Queda como hero oficial de la landing activa. |
| `components/marketing/landing-section.tsx` | Modify | Primitive base para secciones narrativas de homepage. |
| `components/marketing/operations-strip.tsx` | Modify | Inserta evidencia operativa temprana y consistente. |
| `components/marketing-actions.tsx` | Modify | Única fuente de CTA para hero y cierre. |
| `components/navbar.tsx` | Modify | Ajusta anchors, CTA visible y URL pública consistente con tenant routes. |
| `components/hero-buttons.tsx` | Deprecate | Reemplazado por `MarketingActions`; hoy contiene `/demo` inválido. |
| `components/como-funciona-button.tsx` | Deprecate | CTA específica redundante; reemplazada por `MarketingActions`. |
| `components/cta-buttons.tsx` | Deprecate | CTA final redundante; reemplazada por `MarketingActions`. |
| `app/globals.css` | Reuse/Modify | Mantiene tokens y utilidades marketing; sólo extender si falta soporte real. |

## Interfaces / Contracts

```ts
type LandingHeroProps = {
  variant: "withImage" | "withoutImage"
}

type MarketingActionsProps = {
  className?: string
  primaryClassName?: string
  secondaryClassName?: string
  secondaryHref?: string
  secondaryLabel?: string
  showSecondary?: boolean
}
```

Contrato esperado:
- `homepage.tsx` decide orden narrativo y anchors.
- `LandingHero` no define lógica de sesión; delega acciones a `MarketingActions`.
- `LandingSection` provee semántica consistente (`section`, heading, body, spacing).
- No deben existir nuevos componentes de CTA paralelos.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|--------------|----------|
| Manual functional | CTA primary/secundary según sesión | Probar logged-out/logged-in y validar destinos reales. |
| Manual UX | Jerarquía visual, consistencia de acciones y lectura hero → operación → cierre | Review comparativa desktop/mobile/tablet. |
| Manual accessibility | Contraste, foco visible, headings, orden semántico y targets táctiles | Navegación por teclado + inspección visual. |
| Manual responsive | Hero, navbar, strip y cards sin overflow ni colisiones | Breakpoints chicos, medianos y grandes. |
| Content QA | Narrativa B2B ticketing + operación sin copy genérico | Revisión contra spec y proposal. |

No hay infraestructura visible de tests UI/E2E para esta iteración; el QA realista es manual y focalizado.

## Migration / Rollout

No migration required. El rollout es un reemplazo progresivo de composición dentro de la landing pública activa.

## Open Questions

- [ ] Confirmar el anchor secundario definitivo (`#producto` vs `#operacion`) para que el CTA no vuelva a quedar ambiguo.
- [ ] Confirmar si `Navbar` debe seguir mostrando `ThemeToggle` en la landing marketing o si distrae del flujo principal.
