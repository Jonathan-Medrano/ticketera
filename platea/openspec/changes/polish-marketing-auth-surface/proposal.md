# Proposal: Polish Marketing Auth Surface

## Intent

Elevar la calidad visual y de UX de `app/(marketing)/login/page.tsx` sin alterar la arquitectura actual del flujo. El cambio debe conservar tabs, layout, stepper y registro en dos pasos, pero corregir fricción visual, accesibilidad, dark mode y consistencia de estados, incluyendo el password input reutilizable.

## Scope

### In Scope
- Refinar jerarquía visual, spacing, contraste y consistencia de cards, tabs, labels, ayudas y CTAs en login y registro.
- Mejorar accesibilidad e interacción: focus visible, navegación por teclado, mensajes de error, targets clickeables y semantics del toggle de contraseña.
- Unificar estados hover, focus, disabled, loading y dark mode en la superficie auth marketing.
- Corregir `components/password-input.tsx` para eliminar decisiones anti-a11y y hardcodes visuales.

### Out of Scope
- Rediseñar tabs, posiciones, layout general, stepper, composición principal o secuencia `cuenta -> empresa`.
- Cambiar validaciones de negocio, copy legal, endpoints, providers auth o redirects.
- Convertir este change en una reescritura del sistema de formularios o de primitives UI globales.

## Capabilities

### New Capabilities
- `marketing-auth-surface`: contrato visual, accesible y consistente para login/registro marketing sin cambiar la estructura del flujo.

### Modified Capabilities
- None.

## Approach

Tomar el flujo actual como restricción arquitectónica y trabajar por capas de polish: ajustar tokens/clases existentes, consolidar estados interactivos y encapsular el password input como primitive accesible y theme-aware.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `app/(marketing)/login/page.tsx` | Modified | Polish visual y de interacción en tabs, cards, formularios, alerts y CTA. |
| `components/password-input.tsx` | Modified | Toggle accesible por teclado, labels/ARIA y estilos sin colores hardcodeados. |
| `components/ui/tabs.tsx` | Modified | Ajustes si hicieran falta para estados visuales/focus consistentes en esta superficie. |
| `components/ui/input.tsx` | Modified | Ajustes menores si hicieran falta para contraste/focus reutilizable. |
| `app/globals.css` | Modified | Tokens o utilidades globales mínimos para dark mode y estados consistentes. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| El polish rompa el layout actual | Med | Tratar estructura como contrato inmutable y limitar cambios a estilos/semantics. |
| Mejora parcial deje inconsistencias entre pasos | Med | Validar login, registro cuenta y registro empresa como una sola superficie. |
| Fix del password input impacte otros usos | Low | Mantener API pública del componente y probar ambos modos visible/oculto. |

## Rollback Plan

Revertir cambios en `app/(marketing)/login/page.tsx`, `components/password-input.tsx` y cualquier ajuste menor de primitives/tokens, recuperando la apariencia anterior sin tocar lógica auth.

## Dependencies

- Primitives UI actuales (`Button`, `Input`, `Tabs`, `Label`) disponibles para consolidar estados sin rediseñar el flujo.

## Success Criteria

- [ ] Login y registro mantienen tabs, posiciones, layout general, stepper y secuencia actual sin cambios estructurales.
- [ ] Todos los controles relevantes son operables por teclado y muestran focus visible en light y dark mode.
- [ ] `components/password-input.tsx` elimina `tabIndex={-1}`, expone un toggle accesible y no usa colores hardcodeados.
- [ ] Los estados hover, focus, disabled, loading y error son visualmente consistentes entre login, paso cuenta y paso empresa.
- [ ] La superficie auth marketing mejora contraste y legibilidad en dark mode sin regressiones funcionales.
