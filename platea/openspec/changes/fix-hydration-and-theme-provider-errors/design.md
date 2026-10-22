# Design: Fix Hydration and Theme Provider Errors

## Technical Approach

Separar responsabilidades entre sesión y tema para que `next-themes` no inyecte su script dentro del árbol actual de `SessionProvider` client-side, y reemplazar el render de fecha problemático en Entradas por una estrategia determinística. La solución debe minimizar superficie de cambio: arreglar primero el caso reportado en `entradas-content.tsx` y mover el `ThemeProvider` a un wrapper global seguro en `app/layout.tsx`, dejando `session-provider.tsx` con una única responsabilidad.

## Architecture Decisions

| Decision | Alternatives considered | Rationale |
|---|---|---|
| Separar `ThemeProvider` de `SessionProvider` | Mantener composición actual y silenciar el warning | El error reportado es estructural; silenciarlo no corrige el problema real. |
| Corregir primero la fecha de Entradas | Barrer todos los `toLocale*` de la app de una sola vez | El bug actual está identificado y concreto; conviene introducir un patrón estable y luego expandirlo si hace falta. |
| Usar formato determinístico para la celda afectada | Dejar `toLocaleString()` y confiar en `timeZone` | Ya vimos evidencia real de mismatch entre server y browser; el enfoque actual no es confiable. |
| Mantener la UX visual equivalente | Hacer render client-only de toda la tabla | Renderizar client-only sería una solución perezosa y regresiva para SSR. |

## Data Flow

App root:
1. `app/layout.tsx` monta providers globales
2. `ThemeProvider` vive en un wrapper seguro
3. `SessionProvider` queda aislado de esa inyección de script

Entradas:
1. SSR recibe `created_at`
2. se formatea con una estrategia estable
3. el cliente hidrata el mismo string
4. no hay mismatch en la celda

## File Changes

| File | Action | Description |
|---|---|---|
| `platea/components/session-provider.tsx` | Modify | Dejar solo responsabilidad de sesión |
| `platea/app/layout.tsx` | Modify | Mover o reubicar provider de tema en wrapper seguro |
| nuevo wrapper de tema si hace falta | Create | Encapsular `ThemeProvider` fuera del provider de sesión |
| `platea/components/dashboard/entradas-content.tsx` | Modify | Reemplazar render de fecha por formato determinístico estable |

## Interfaces / Contracts

### Stable date formatting contract

La fecha mostrada en Entradas debe seguir siendo legible para el usuario, pero con serialización estable entre server y client.

Ejemplo de objetivo aceptable:
- `02/05/2026, 22:05`

Lo importante NO es el formato exacto, sino que sea consistente.

### Provider composition contract

El árbol global debe permitir:
- sesión activa
- tema funcional
- cero errores de script injection en runtime

## Validation & Error Handling

- Si una fecha es inválida, mostrar fallback estable como `—` y no romper hydration.
- Si el provider de tema falla al moverse, el error debe detectarse en runtime/lint antes de cerrar el change.

## Testing Strategy

| Layer | What to Test | Approach |
|---|---|---|
| Static | Provider composition | Revisar estructura final de `app/layout.tsx` y wrapper(s) |
| Runtime | No hydration mismatch in entries | Validación manual en la vista afectada y/o pruebas donde sea posible |
| Runtime | No script-render error | Validación manual/browser console después del cambio |
| Lint | Affected files | Eslint sobre providers y componente de entradas |

## Migration / Rollout

Fase 1: separar providers globales sin cambiar comportamiento visible.  
Fase 2: aplicar formato estable a Entradas.  
Fase 3: validar en runtime que ambos errores desaparecieron.

## Open Questions

- [ ] Confirmar si luego conviene propagar el mismo helper de fecha estable a otros módulos con `toLocaleDateString`/`toLocaleString` en Client Components SSR.
