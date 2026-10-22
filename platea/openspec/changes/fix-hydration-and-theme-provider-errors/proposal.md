# Proposal: Fix Hydration and Theme Provider Errors

## Intent

Hoy el dashboard muestra dos errores de runtime serios: un hydration mismatch en la tabla de entradas por formateo de fecha no estable entre servidor y cliente, y un error de script al montar `next-themes` dentro del `SessionProvider` client-side. Este cambio corrige ambos problemas para que la app no regenere árboles innecesariamente ni dispare errores globales de render.

## Scope

### In Scope
- Eliminar hydration mismatch causado por formateo de fechas inestable en el módulo de entradas.
- Reubicar o reestructurar providers globales para que `next-themes` no inyecte un `<script>` dentro de un Client Component problemático.
- Mantener el comportamiento visual esperado de tema y sesión sin romper layouts existentes.

### Out of Scope
- Reescribir todos los formatos de fecha de la app.
- Cambiar librerías de sesión o de tema.
- Rediseñar la UI del módulo Entradas.

## Capabilities

### New Capabilities
- `stable-client-server-date-rendering`: fechas críticas del dashboard renderizan igual en SSR y cliente.
- `safe-theme-provider-mounting`: el provider de tema se monta en una posición compatible con el runtime actual de Next/React.

### Modified Capabilities
- `dashboard-ticketing-render`: la tabla de entradas deja de disparar hydration mismatch.
- `global-app-providers`: la raíz de la app deja de renderizar el script de tema en un contexto inválido.

## Approach

Crear una ruta de render estable para fechas del módulo de entradas, evitando depender de serialización locale-sensitive distinta entre servidor y navegador. En paralelo, separar el `ThemeProvider` del `SessionProvider` actual para que el script de `next-themes` quede montado en un wrapper correcto dentro del layout raíz y no dentro del árbol problemático del provider de sesión.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `platea/components/dashboard/entradas-content.tsx` | Modified | Render de fecha estable sin hydration mismatch |
| `platea/components/session-provider.tsx` | Modified | Dejar solo la responsabilidad de sesión |
| `platea/app/layout.tsx` | Modified | Reubicar el provider de tema/global wrapper |
| nuevo wrapper de tema si hace falta | New | Encapsular `ThemeProvider` en ubicación segura |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Corregir entradas pero dejar otros puntos con fechas inestables | Med | Empezar por el caso reportado y dejar patrón reusable |
| Romper el cambio de tema al mover providers | Med | Mantener props actuales de `ThemeProvider` y probar layouts principales |
| Introducir otro mismatch por solución client-only apresurada | Med | Preferir formato determinístico o wrapper estable antes que hacks rápidos |

## Rollback Plan

Revertir el wrapper/provider y volver al render anterior si el tema deja de funcionar, manteniendo el diagnóstico para iterar con otra ubicación de provider.

## Dependencies

- Confirmar la forma segura de montar `next-themes` en esta versión de Next.
- Definir una estrategia de formato de fecha estable entre server y client.

## Suggested Phases

1. Corregir providers globales (`ThemeProvider` / `SessionProvider`).
2. Corregir render de fechas en Entradas.
3. Verificar ausencia de errores de hydration y script runtime.

## Success Criteria
- [ ] La tabla de entradas no dispara hydration mismatch por formateo de fecha.
- [ ] La raíz de la app no dispara el error de script asociado a `next-themes`.
- [ ] El cambio de tema sigue funcionando correctamente después de la reestructuración.
