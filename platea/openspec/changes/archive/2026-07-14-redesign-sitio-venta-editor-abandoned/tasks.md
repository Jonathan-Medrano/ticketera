# Tasks: Redesign Sitio de Venta Editor

## Phase 1: Shell y base editorial

- [x] 1.1 Reorganizar `components/dashboard/sitio-venta/editor-container.tsx` para componer `domainItems` con `summary`, `form`, `preview` y `density`, sin tocar draft, dirty state ni `serializeSitioVentaPayload`.
- [x] 1.2 Rehacer `components/dashboard/sitio-venta/editor-shell.tsx` para renderizar toolbar sobria, subnav liviana y un único canvas dominante por dominio.
- [x] 1.3 Ajustar `components/dashboard/sitio-venta/section-primitives.tsx` para reemplazar cards/helpers pesados por primitives más sobrias para grupos, choices y ayudas compactas.

## Phase 2: Dominios principales

- [x] 2.1 Reestructurar `components/dashboard/sitio-venta/sections/identidad-section.tsx` para contar una sola narrativa: identidad pública → URL → branding → assets.
- [x] 2.2 Reordenar `components/dashboard/sitio-venta/sections/home-section.tsx` y `section-primitives.tsx` en secuencia `layout → visibilidad → copy → referencia`, eliminando ejemplos pesados duplicados.
- [x] 2.3 Rediseñar `components/dashboard/sitio-venta/preview/runtime-preview.tsx` para que `Identidad` y `Home/Eventos` usen previews secundarios, compactos y no co-iguales al formulario.

## Phase 3: Dominios de alcance acotado

- [x] 3.1 Rehacer `components/dashboard/sitio-venta/sections/consumibles-section.tsx` como resumen/estado editorial compacto, sin abrir negocio nuevo.
- [x] 3.2 Compactar `components/dashboard/sitio-venta/sections/soporte-section.tsx` y `section-primitives.tsx` para dejar contacto + FAQs con menos wrappers y mejor prioridad visual.
- [x] 3.3 Ajustar `components/dashboard/sitio-venta/preview/runtime-preview.tsx` para que `Consumibles` y `Soporte` usen referencias proporcionales a su alcance y excluyan `Mis tickets`.

## Phase 4: Verificación

- [x] 4.1 Actualizar tests de `components/dashboard/sitio-venta/preview/runtime-preview.test.ts` para cubrir preview secundario, una sola referencia principal en `Home/Eventos` y densidad liviana en dominios menores.
- [x] 4.2 Confirmar en `components/dashboard/sitio-venta/model.test.ts` que el rediseño no altera ownership, draft, dirty map ni payload.
- [ ] 4.3 Ejecutar smoke manual del editor: cambiar dominio, editar campos, conservar draft, guardar con el contrato actual y validar una sola tarea principal por dominio.
