# Proposal: Redesign Marketing Static Pages

## Intent

Elevar `terminos`, `privacidad`, `soporte` y `contacto` al mismo estándar visual y de UX de la superficie marketing actual. El cambio debe reemplazar layouts básicos o incompletos, mejorar legibilidad, accesibilidad y responsive, y preservar sin regressions la bifurcación tenant-aware ya existente en soporte.

## Scope

### In Scope
- Rediseñar las páginas marketing estáticas usando el lenguaje visual vigente (`marketing-shell`, `marketing-panel`, tokens y jerarquías consistentes).
- Crear una experiencia de lectura/contacto más clara en `terminos`, `privacidad` y `contacto`, hoy desalineadas o incompletas.
- Reordenar `soporte` para mejorar estructura, FAQ, CTAs y accesibilidad sin romper `resolveTenantFromHost()` ni el render de `TenantSoportePage`.
- Unificar navegación secundaria, spacing, semantics y estados responsive entre las cuatro páginas.

### Out of Scope
- Reescribir la lógica tenant-aware de soporte o cambiar el comportamiento de `app/t/[tenant]/soporte/page`.
- Cambiar políticas legales de fondo, reglas de negocio, emails operativos o contenido jurídico fuera del polish necesario.
- Rediseñar homepage, navbar global o dashboard más allá de ajustes mínimos de integración visual.

## Capabilities

### New Capabilities
- `marketing-static-pages`: contrato visual, accesible y consistente para páginas institucionales marketing y contacto.

### Modified Capabilities
- None.

## Approach

Tomar como restricción la arquitectura actual: reutilizar tokens y patrones marketing ya consolidados, extraer una composición compartible para páginas estáticas cuando convenga, y tratar `soporte` como caso especial con guard clause tenant-first. Primero se alinea estructura y semantics; después copy, CTA y polish responsive.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/(marketing)/terminos/page.tsx` | Modified | Documento legal con shell marketing y mejor jerarquía de lectura. |
| `app/(marketing)/privacidad/page.tsx` | Modified | Política con layout, anchors/sections y legibilidad consistentes. |
| `app/(marketing)/soporte/page.tsx` | Modified | Polish visual/UX preservando bifurcación tenant-aware. |
| `app/(marketing)/contacto/page.tsx` | Modified | Reemplaza placeholder actual por página real de contacto. |
| `app/globals.css` | Modified | Ajustes mínimos de tokens/utilidades si faltan primitives para estas superficies. |
| `components/marketing/*` | Modified | Posible extracción o ajuste de primitives reutilizables para static pages. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| El rediseño rompa el branch tenant-aware de soporte | Med | Mantener `resolveTenantFromHost()` como contrato y validar ambos paths. |
| Polish parcial deje cuatro páginas con patrones distintos | Med | Definir shell compartido y checklist común de states/spacing/semantics. |
| Cambios de copy mezclen diseño con definición legal | Low | Limitarse a claridad editorial y respetar el contenido vigente salvo ajustes obvios. |

## Rollback Plan

Revertir los cambios en las cuatro rutas marketing y cualquier primitive/tokens asociados, restaurando los layouts previos mientras se conserva intacta la lógica tenant-aware de soporte.

## Dependencies

- Tokens y primitives marketing ya presentes en `app/globals.css`, homepage y navbar.
- Validación posterior en specs de accesibilidad, responsive y preservación del flujo tenant-aware.

## Success Criteria

- [ ] `terminos`, `privacidad`, `soporte` y `contacto` comparten una dirección visual coherente con la homepage marketing actual.
- [ ] `app/(marketing)/contacto/page.tsx` deja de ser un placeholder y expone contenido/CTAs útiles.
- [ ] `app/(marketing)/soporte/page.tsx` mantiene el branch tenant-aware y sigue renderizando `TenantSoportePage` cuando corresponde.
- [ ] Las cuatro páginas mejoran semantics, contraste, focus visible y lectura responsive sin introducir regressions evidentes.
