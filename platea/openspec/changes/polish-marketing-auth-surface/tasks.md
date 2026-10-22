# Tasks: Polish Marketing Auth Surface

## Phase 1: Base visual y contratos locales

- [x] 1.1 Revisar `app/(marketing)/login/page.tsx` y consolidar clases compartidas de card, spacing, headings y mensajes sin cambiar tabs, layout base ni orden de pasos.
- [x] 1.2 Ajustar `components/password-input.tsx` para mejorar contraste, área clickeable, focus visible y atributos accesibles del toggle sin tocar su comportamiento.
- [x] 1.3 Evaluar si `components/ui/tabs.tsx`, `components/ui/input.tsx` o `components/ui/button.tsx` necesitan un ajuste local/variant mínimo para sostener el polish de auth sin romper otros usos.

## Phase 2: Polish de login

- [x] 2.1 Mejorar en `app/(marketing)/login/page.tsx` la jerarquía visual del bloque login: branding, card, títulos, divider y CTAs con mejor dark mode y responsive.
- [x] 2.2 Refinar la presentación de `TabsList` y `TabsTrigger` en login/register para dar mejor estado activo, hover y focus sin cambiar la interacción actual.
- [x] 2.3 Reordenar solo estilos internos del formulario de login para que labels, helper text, reset link y campos tengan espaciado y lectura más claros.
- [x] 2.4 Mejorar feedback de login en `page.tsx` con contenedores consistentes para error, sesión expirada y loading, usando `aria-live` donde corresponda.
- [x] 2.5 Ajustar estados visuales de los botones “Iniciar sesión” y “Continuar con Google” para disabled/loading/focus-visible consistentes en light y dark.

## Phase 3: Polish de registro multi-step

- [x] 3.1 Aplicar en `app/(marketing)/login/page.tsx` el mismo contrato visual al paso `cuenta`, preservando exactamente campos, orden y CTA actual.
- [x] 3.2 Mejorar responsive del grid nombre/apellido y los textos auxiliares de contraseña/términos para evitar cortes o densidad excesiva en mobile.
- [x] 3.3 Pulir `StepIndicator` y el bloque del paso `empresa` para que progreso, separación entre secciones y jerarquía del CTA se lean mejor en ambos themes.
- [x] 3.4 Refinar el campo compuesto de subdominio en `page.tsx` para contraste, bordes, alineación y legibilidad de `.plateapro.com` sin cambiar validación ni flujo.
- [x] 3.5 Homogeneizar mensajes de error y estados de “Volver” / “Crear cuenta gratis” para que el segundo paso mantenga consistencia visual y accesible con login.

## Phase 4: Accesibilidad y validación manual

- [ ] 4.1 Verificar manualmente navegación por teclado en `app/(marketing)/login/page.tsx`: tabs, campos, toggle de contraseña, links y CTAs con focus visible correcto.
- [ ] 4.2 Verificar manualmente responsive en mobile, tablet y desktop para login, registro paso `cuenta` y registro paso `empresa` sin alterar layout base.
- [ ] 4.3 Verificar manualmente dark mode/light mode, contraste de textos, bordes, estados hover/focus/disabled y legibilidad de feedbacks.
- [ ] 4.4 Verificar manualmente que no cambien flujo, tabs, orden de pasos, submits, validaciones existentes ni redirecciones del auth surface.
