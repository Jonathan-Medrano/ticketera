# Proposal: Redesign Marketing Landing

## Intent

Consolidar la arquitectura real de la landing marketing para que la homepage activa deje de mezclar composición vieja con primitives nuevas sin integrar. El cambio debe alinear artifacts y código, reforzar una narrativa B2B de ticketing + operación en vivo, unificar CTAs y corregir inconsistencias verificadas como el enlace roto a `/demo`.

## Scope

### In Scope
- Integrar en `app/(marketing)/homepage.tsx` la arquitectura marketing ya creada pero hoy subutilizada.
- Reordenar hero, secciones y CTA alrededor de venta, gestión y control operativo.
- Unificar la estrategia de acciones entre `HeroButtons`, `MarketingActions` y CTA final.
- Corregir enlaces o destinos inexistentes en la homepage activa.

### Out of Scope
- Crear una nueva identidad visual desde cero o cambiar la paleta base definida en `app/globals.css`.
- Reescribir producto interno, auth o flujos dashboard.
- Considerar como entregable la mera existencia de primitives no integradas.

## Capabilities

### New Capabilities
- `marketing-landing`: Homepage marketing coherente, integrada y orientada a ticketing/operación con CTA válidos.

### Modified Capabilities
- None.

## Approach

Tomar como fuente de verdad el estado verificado del código: preservar los tokens y primitives ya creados (`landing-hero`, `landing-section`, `operations-strip`, `marketing-actions`) y cerrar la brecha con la homepage activa mediante integración real, consolidación narrativa y eliminación de CTA redundantes o inválidos.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/redesign-marketing-landing/proposal.md` | Modified | Actualiza el intent al estado real verificado. |
| `app/(marketing)/homepage.tsx` | Modified | Principal superficie a consolidar e integrar. |
| `components/marketing/landing-hero.tsx` | Modified | Primitive existente a adoptar o ajustar para el hero real. |
| `components/marketing/landing-section.tsx` | Modified | Primitive base para unificar secciones activas. |
| `components/marketing/operations-strip.tsx` | Modified | Refuerza la narrativa operativa dentro de la landing. |
| `components/marketing-actions.tsx` | Modified | Punto objetivo para CTA consistentes. |
| `components/hero-buttons.tsx` | Modified | Debe dejar de apuntar a `/demo`. |
| `app/globals.css` | Modified | Tokens marketing existentes a reutilizar, no recrear. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Migración parcial que deje dos sistemas de CTA coexistiendo | Med | Definir una sola fuente de CTA para homepage. |
| Integrar primitives sin ajustar copy y jerarquía | Med | Validar narrativa completa, no solo layout. |
| Cambiar estructura y mantener links inválidos | Low | Verificar destinos reales usados por cada CTA. |

## Rollback Plan

Revertir la homepage a la composición previa en `app/(marketing)/homepage.tsx` y restaurar los CTAs anteriores si la integración rompe narrativa o navegación, manteniendo intactas las primitives nuevas hasta redefinir su adopción.

## Dependencies

- Specs que formalicen estructura de homepage, contrato de CTAs y narrativa marketing.

## Success Criteria

- [ ] `app/(marketing)/homepage.tsx` usa la arquitectura marketing consolidada y no depende solo de la composición vieja.
- [ ] La landing comunica explícitamente venta, gestión y control operativo para empresas/eventos.
- [ ] Los CTAs de hero y cierre quedan unificados y no enlazan a rutas inexistentes.
- [ ] El artifact describe con claridad qué ya existe como primitive y qué falta integrar de verdad.
