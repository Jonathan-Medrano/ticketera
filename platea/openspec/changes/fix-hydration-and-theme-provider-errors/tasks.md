# Tasks: Fix Hydration and Theme Provider Errors

## Phase 1: Providers globales

- [ ] 1.1 Separar `ThemeProvider` de `SessionProvider` para evitar el error de script en runtime.
- [ ] 1.2 Ajustar `app/layout.tsx` y cualquier wrapper nuevo para mantener sesión + tema funcionando.

## Phase 2: Fecha estable en Entradas

- [ ] 2.1 Reemplazar el render problemático de `created_at` en `entradas-content.tsx` por una estrategia estable entre SSR y cliente.
- [ ] 2.2 Asegurar fallback seguro si el valor de fecha es inválido.

## Phase 3: Verificación

- [ ] 3.1 Verificar por lint los archivos tocados.
- [ ] 3.2 Validar que la vista de Entradas ya no dispare hydration mismatch.
- [ ] 3.3 Validar que el app root ya no dispare el error de script asociado al theme provider.
