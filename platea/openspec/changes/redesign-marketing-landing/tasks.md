# Tasks: Redesign Marketing Landing

## Phase 1: Consolidación de base real

- [x] 1.1 Verificar `openspec/changes/redesign-marketing-landing/{proposal.md,design.md,specs/marketing-landing-redesign/spec.md}` contra el estado real del repo y asumir que la homepage activa sigue en `app/(marketing)/homepage.tsx`.
- [x] 1.2 Crear y dejar disponibles `components/marketing/landing-hero.tsx`, `components/marketing/landing-section.tsx` y `components/marketing/operations-strip.tsx` como primitives reutilizables.
- [x] 1.3 Consolidar `components/marketing-actions.tsx` como contrato de CTA con lógica por sesión y jerarquía primary/secondary.
- [x] 1.4 Dejar `components/navbar.tsx` con navegación marketing corta y CTA visible en desktop/mobile.
- [x] 1.5 Ajustar `openspec/changes/redesign-marketing-landing/tasks.md` para reflejar únicamente trabajo realmente implementado y trabajo pendiente de integración.

## Phase 2: Integración de homepage activa

- [x] 2.1 Reescribir `app/(marketing)/homepage.tsx` para montar `LandingHero`, `OperationsStrip`, `LandingSection` y `MarketingActions` como arquitectura principal de la landing.
- [x] 2.2 Reemplazar el hero inline actual de `app/(marketing)/homepage.tsx` por `LandingHero` y definir una variante por defecto (`withImage` o `withoutImage`) consistente con el spec.
- [x] 2.3 Reordenar la secuencia de `app/(marketing)/homepage.tsx` a: hero -> prueba operativa -> capacidades clave -> credibilidad/producto -> cierre.
- [x] 2.4 Migrar la sección “Cómo funciona” y la grilla de features a bloques compuestos con `LandingSection`, evitando repetir layouts legacy y cards SaaS genéricas.
- [x] 2.5 Conectar `OperationsStrip` dentro de la homepage activa para reforzar venta, gestión y control operativo desde el primer scroll.
- [x] 2.6 Revisar headings y copy de `app/(marketing)/homepage.tsx` para que la narrativa quede alineada con `spec.md` y no dependa de texto legacy.

## Phase 3: Unificación de CTAs y cleanup

- [x] 3.1 Sustituir en `app/(marketing)/homepage.tsx` el uso de `HeroButtons`, `ComoFuncionaButton` y `CtaButton` por `MarketingActions` donde corresponda.
- [x] 3.2 Corregir el destino inválido `/demo` removiéndolo o reemplazándolo por una ruta/ancla real en `components/hero-buttons.tsx` o eliminando ese componente de la homepage.
- [x] 3.3 Definir el estado final de `components/hero-buttons.tsx`, `components/como-funciona-button.tsx` y `components/cta-buttons.tsx`: reutilizar, deprecar explícitamente o borrar si quedan sin uso.
- [x] 3.4 Verificar que `components/navbar.tsx` y los CTAs de la homepage compartan una sola acción principal dominante y una secundaria subordinada.

## Phase 4: Validación y cierre del change

- [ ] 4.1 Validar manualmente `app/(marketing)/homepage.tsx` contra `openspec/changes/redesign-marketing-landing/specs/marketing-landing-redesign/spec.md` para confirmar identidad editorial + operación en vivo.
- [ ] 4.2 Validar responsive y estados logged-out/logged-in en `LandingHero`, `MarketingActions` y `Navbar`, asegurando jerarquía estable de CTA.
- [x] 4.3 Confirmar que no queden imports muertos, anchors inconsistentes ni componentes legacy usados por la homepage activa.
- [ ] 4.4 Reabrir `openspec/changes/redesign-marketing-landing/verify-report.md` una vez integrada la homepage para cerrar el FAIL actual con evidencia real.
