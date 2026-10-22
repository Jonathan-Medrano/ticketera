# Design: Polish Marketing Auth Surface

## Technical Approach

La mejora se implementará **sin alterar el flujo ni el layout principal** de `app/(marketing)/login/page.tsx`: se conservan tabs arriba, card central, stepper, orden de bloques y lógica de login/registro de dos pasos. El trabajo consiste en refinar la capa visual y accesible sobre la estructura actual, moviendo clases repetidas a helpers/subcomponentes internos livianos y alineando el surface con los tokens marketing ya existentes en `app/globals.css`.

La estrategia realista es:
- mantener `AuthContent` como entrypoint client-side y dueño del estado;
- extraer primitives locales de presentación (`AuthCard`, `AuthField`, `InlineMessage`, `AuthDivider`) sólo si reducen duplicación;
- mejorar `PasswordInput` para foco, toggle accesible y estados inválidos sin cambiar su propósito;
- extender tokens/utilidades marketing sólo donde hoy falten contrastes, dark mode y consistencia mobile.

## Architecture Decisions

| Decisión | Opciones | Elección y tradeoff |
|---|---|---|
| Alcance estructural | Rehacer formulario / iterar sobre la página actual | Iterar sobre `app/(marketing)/login/page.tsx`. Tradeoff: sigue siendo un archivo grande, pero minimiza riesgo sobre login, tabs y stepper ya verificados. |
| Reutilización visual | Clases inline en cada campo / subcomponentes internos mínimos | Helpers/subcomponentes internos no exportados. Tradeoff: una abstracción pequeña más, pero mejora consistencia de spacing, errores inline y copy auxiliar sin abrir una refactorización global. |
| Surface marketing | Estilos ad-hoc con `bg-card` / reutilizar tokens marketing | Reutilizar `marketing-shell` y `marketing-panel`, extendiendo sólo tokens puntuales. Tradeoff: acopla la auth surface al lenguaje marketing, pero eso es exactamente el objetivo visual buscado. |
| Validación UI | Error global único / error global + hints inline por campo | Mantener error global para fallos de submit y sumar hints/estados inline para contraseña, confirmación y slug. Tradeoff: más ramificación visual, pero mejora claridad y accesibilidad. |
| Password toggle | Botón decorativo no focuseable / control accesible real | Hacer el toggle focuseable, con `aria-label`, `aria-pressed` y contraste correcto. Tradeoff: un stop más en teclado, pero corrige una deuda accesible real. |

## Data Flow

```text
AuthPage(Suspense)
  -> AuthContent
     -> Tabs(login | registro)
        -> AuthCard
           -> AuthField/Input | PasswordInput | InlineMessage
           -> CTA submit / CTA Google / helper copy

Estado existente
  -> tab, paso, loadingCredentials, loadingGoogle, error
  -> datos de formulario
  -> helpers visuales derivan invalid/description por campo
```

Regla operativa:
- la lógica de `signIn`, `fetch("/api/auth/registro")`, stepper y routing se mantiene;
- los helpers nuevos sólo reciben props visuales/accesibles y no toman ownership del flujo.

## File Changes

| File | Action | Description |
|---|---|---|
| `openspec/changes/polish-marketing-auth-surface/design.md` | Create | Diseño técnico de la mejora visual y accesible. |
| `app/(marketing)/login/page.tsx` | Modify | Refinar surface, tabs, card, campos, inline errors, CTA Google, copy y responsive sin cambiar estructura principal. |
| `components/password-input.tsx` | Modify | Mejorar foco, toggle accesible, padding interno, contraste y soporte de estado inválido. |
| `app/globals.css` | Modify | Ajustar/expandir utilidades o tokens marketing para card, overlays suaves y dark mode consistente. |

## Interfaces / Contracts

```tsx
type AuthFieldProps = {
  label: string
  hint?: string
  error?: string
  required?: boolean
  children: React.ReactNode
}

type InlineMessageProps = {
  id?: string
  tone: "error" | "warning" | "muted"
  children: React.ReactNode
}

type PasswordInputProps = React.ComponentProps<typeof Input> & {
  className?: string
}
```

Contratos:
- `PasswordInput` MUST seguir siendo un wrapper de `Input` con show/hide password.
- Los campos con error SHOULD conectar `aria-invalid`, `aria-describedby` y mensaje inline.
- `page.tsx` MAY declarar subcomponentes internos, pero no mover la lógica a un nuevo flujo compartido.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Manual UX | Jerarquía visual de tabs, card, stepper, CTA principal/Google y copy auxiliar | Review visual desktop y mobile comparando antes/después con mismo layout. |
| Manual accessibility | Focus visible, orden de tabulación, contraste, labels, `aria-invalid`, toggle password | Navegación sólo teclado + inspección de atributos en DevTools. |
| Manual validation | Password mismatch, password corta, slug inválido, error de credenciales, session warning | Ejecutar escenarios reales y verificar error inline + mensaje global cuando corresponda. |
| Manual dark mode | Surface, tabs activas, inputs, botones outline y textos auxiliares | Revisar light/dark en estados idle, hover, focus, invalid y loading. |
| Manual responsive | 320px–768px: tabs, grids de nombre/apellido, slug suffix y CTAs sin overflow | QA en breakpoints chicos y touch targets. |

No se propone una suite automatizada nueva para esta iteración: el riesgo es principalmente visual, interactivo y accesible.

## Migration / Rollout

No migration required. El rollout es directo sobre la página de login marketing existente.

## Open Questions

- [ ] Confirmar si el CTA Google en registro debe mantener el copy `Registrarse con Google` o unificarse con `Continuar con Google` para consistencia cross-tab.
