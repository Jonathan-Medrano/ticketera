# Design: Redesign Marketing Static Pages

## Technical Approach

Las cuatro rutas seguirán siendo entrypoints propios en `app/(marketing)`, pero dejarán de resolver layout y bloques inline de forma aislada. La implementación debe consolidar una mini-arquitectura marketing para páginas estáticas: shell común, navegación consistente, footer compartido, secciones reutilizables y CTA final reutilizable.

`soporte` conserva su guard clause actual: `resolveTenantFromHost()` decide primero y, si existe tenant, devuelve `TenantSoportePage` sin pasar por el shell marketing. Sólo el branch público/no-tenant se rediseña. `terminos` y `privacidad` pasan a un layout editorial largo con navegación interna por anchors. `contacto` deja de ser placeholder y se implementa como página institucional estática, sin inventar backend nuevo.

## Architecture Decisions

| Decisión | Alternativas consideradas | Elección | Rationale |
|---|---|---|---|
| Shell compartido | Mantener cada página inline / crear layout marketing estático | Crear `StaticMarketingPageShell` | Evita repetir navbar, ancho, spacing, CTA y footer; alinea las cuatro páginas al lenguaje actual. |
| Navbar en páginas internas | Reusar `Navbar` con `#anchors` locales / navbar separado | Adaptar `Navbar` para aceptar links absolutos (`/#producto`, `/#como-funciona`) o variant interno | El navbar actual sirve para homepage, pero en rutas internas los anchors locales no existen. Hay que resolver eso SIN duplicar componente. |
| Soporte tenant-aware | Reescribir routing / envolver ambos casos en un shell único | Mantener `if (tenant) return <TenantSoportePage />` | Minimiza riesgo y preserva el contrato real ya verificado. |
| Contacto | Crear formulario con API nueva / página estática con canales claros | Página estática con cards de contacto y CTA | Hoy no existe backend de contacto; agregar uno mezcla diseño con producto y aumenta riesgo innecesario. |
| FAQ y legal content | Contenido libre por página / primitives de sección reutilizables | Reutilizar `StaticPageSection`, `PageToc`, `FaqList` | Mejora lectura, semántica y mantenimiento sin sobre-abstracting la lógica. |

## Data Flow

```text
terminos|privacidad|contacto
  -> StaticMarketingPageShell
     -> Navbar(links internos absolutos)
     -> hero/header editorial
     -> optional PageToc / content sections
     -> optional CTA band
     -> MarketingFooter

soporte
  -> resolveTenantFromHost()
     -> tenant ? TenantSoportePage
               : StaticMarketingPageShell + support sections + FAQ + CTA
```

CTA flow:
- Primario: `MarketingActions` mantiene `/login?tab=registro` para anónimo y `/dashboard` para usuario con sesión.
- Secundario: `terminos`/`privacidad` apuntan a `/contacto` o `/soporte`; `contacto` apunta a `/soporte`; `soporte` puede apuntar a homepage producto o login.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/redesign-marketing-static-pages/design.md` | Create | Diseño técnico de la arquitectura compartida. |
| `app/(marketing)/terminos/page.tsx` | Modify | Migra a shell editorial con índice por anchors y CTA final discreto. |
| `app/(marketing)/privacidad/page.tsx` | Modify | Igual patrón que términos, con secciones navegables y mejor legibilidad. |
| `app/(marketing)/soporte/page.tsx` | Modify | Conserva guard clause tenant-aware y delega sólo el branch público a primitives nuevas. |
| `app/(marketing)/contacto/page.tsx` | Modify | Reemplaza placeholder por página real de contacto institucional. |
| `components/navbar.tsx` | Modify | Soporta links válidos fuera de homepage sin forkear el componente. |
| `components/marketing/static-marketing-page-shell.tsx` | Create | Compone navbar, `main#main-content`, container, CTA opcional y footer. |
| `components/marketing/marketing-footer.tsx` | Create | Extrae el footer hoy inline en `app/(marketing)/homepage.tsx`. |
| `components/marketing/static-page-section.tsx` | Create | Primitive para heading, body, spacing y agrupación de contenido estático. |
| `components/marketing/page-toc.tsx` | Create | Navegación interna para páginas largas; sticky en desktop, horizontal/stacked en mobile. |
| `components/marketing/faq-list.tsx` | Create | Lista/accordion liviano para FAQ de soporte y preguntas de contacto si aplica. |
| `components/marketing-actions.tsx` | Reuse | CTA final compartido, sin crear variantes paralelas. |
| `app/(marketing)/homepage.tsx` | Modify | Reemplaza footer inline por `MarketingFooter`. |

## Interfaces / Contracts

```tsx
type StaticMarketingPageShellProps = {
  title: string
  eyebrow?: string
  description?: string
  toc?: Array<{ id: string; label: string }>
  cta?: { secondaryHref?: string; secondaryLabel?: string }
  children: React.ReactNode
}

type FaqItem = { question: string; answer: string }
```

Contratos:
- todas las páginas marketing MUST exponer `main id="main-content"`;
- `terminos` y `privacidad` SHOULD generar ids estables por sección para TOC y deep links;
- `soporte` MUST preservar el branch tenant antes de renderizar UI pública.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Manual functional | `soporte` tenant vs no-tenant | Validar host raíz y host tenant; confirmar que `TenantSoportePage` sigue intacta. |
| Manual UX/content | Jerarquía, CTA y navegación interna | Review desktop/mobile de las 4 páginas, incluyendo TOC, footer y CTA final. |
| Manual accessibility | Skip link, foco visible, headings, `aria-current`, contraste, targets táctiles | Navegación sólo teclado + inspección visual en light/dark. |
| Manual responsive | TOC, cards, FAQ, bloques legales largos | QA en 320px, 768px y desktop ancho, sin overflow ni columnas rotas. |
| Manual link QA | `mailto`, links a homepage, contacto/soporte y anchors | Verificar destinos reales y que no haya anchors muertos fuera de homepage. |

No se propone suite automatizada nueva: el riesgo principal es de composición, navegación y accesibilidad visual.

## Migration / Rollout

No migration required. Rollout directo sobre las rutas marketing existentes.

## Open Questions

- [ ] Confirmar si `contacto` debe quedarse como página institucional estática en esta change o si habrá un futuro backend/formulario en una change separada.
