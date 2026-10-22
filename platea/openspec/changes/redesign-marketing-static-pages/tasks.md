# Tasks: Redesign Marketing Static Pages

## Phase 1: Base y contrato compartido

- [x] 1.1 Relevar `app/(marketing)/{contacto,terminos,privacidad,soporte}/page.tsx` y confirmar qué copy, secciones y CTA quedan en cada ruta sin mezclar soporte marketing con soporte tenant.
- [x] 1.2 Crear o consolidar un shell reutilizable para páginas estáticas en `components/marketing/` (por ejemplo `static-page-shell.tsx`) con ancho, spacing, heading, breadcrumb/back link y bloque de metadata.
- [x] 1.3 Crear primitives de contenido para páginas largas en `components/marketing/` (por ejemplo `static-page-section.tsx`, `static-page-aside.tsx` o equivalente) para listas, subsecciones y bloques destacados con legibilidad consistente.
- [x] 1.4 Definir en esos primitives el contrato responsive y accesible: jerarquía `h1/h2`, focus visible, anchors legibles, `max-width` de lectura y espaciado estable en mobile/desktop.

## Phase 2: Términos y Privacidad

- [x] 2.1 Refactorizar `app/(marketing)/terminos/page.tsx` para montar el shell compartido y separar el contenido legal en secciones legibles, sin perder el contenido vigente.
- [x] 2.2 Refactorizar `app/(marketing)/privacidad/page.tsx` con el mismo layout compartido, mejorando lectura, agrupación de listas y consistencia visual respecto de `terminos`.
- [x] 2.3 Incorporar navegación interna o índice simple en `terminos` y `privacidad` si el largo final lo justifica, cuidando scroll, anchors y headings únicos.
- [x] 2.4 Revisar metadata, fecha de actualización, textos auxiliares y CTA de retorno en ambas páginas para que queden consistentes con la identidad marketing actual.

## Phase 3: Contacto y Soporte marketing

- [x] 3.1 Reemplazar el placeholder de `app/(marketing)/contacto/page.tsx` por una página completa usando el shell compartido, con canales de contacto, expectativas de respuesta y derivaciones claras.
- [x] 3.2 Mejorar `app/(marketing)/soporte/page.tsx` usando los nuevos primitives solo en la rama marketing (`if (!tenant)`), preservando intacto el desvío a `app/t/[tenant]/soporte/page.tsx`.
- [x] 3.3 Reordenar el contenido marketing de soporte para distinguir consultas de empresas, compradores, urgencias y datos personales sin tocar `components/tenant/soporte-content.tsx`.
- [x] 3.4 Verificar que cualquier CTA o mailto usado en `contacto` y `soporte` tenga labels claros, targets correctos y fallback textual visible.

## Phase 4: Navegación e integración

- [x] 4.1 Revisar `components/navbar.tsx` y el footer de `app/(marketing)/homepage.tsx` para asegurar acceso claro a `terminos`, `privacidad`, `soporte` y `contacto` sin duplicación confusa.
- [x] 4.2 Unificar estilos de links de retorno, breadcrumbs o navegación lateral entre las cuatro páginas estáticas para que el usuario no cambie de patrón entre rutas.
- [x] 4.3 Confirmar que los nuevos primitives no impacten rutas tenant ni pantallas ajenas a marketing, dejando imports y responsabilidades bien aislados.

## Phase 5: Accesibilidad, responsive y validación manual

- [ ] 5.1 Validar manualmente keyboard navigation en `contacto`, `terminos`, `privacidad` y `soporte`: orden de tab, focus visible, links, anchors y lectura de headings.
- [ ] 5.2 Validar manualmente responsive en mobile, tablet y desktop para las cuatro páginas, revisando ancho de lectura, saltos de línea, cards y bloques legales extensos.
- [ ] 5.3 Validar manualmente contraste, estados hover/focus y semántica general en light/dark mode si aplica al marketing shell actual.
- [ ] 5.4 Validar manualmente el branch tenant de soporte entrando por host tenant para confirmar que `app/(marketing)/soporte/page.tsx` sigue derivando correctamente y no rompe `SoporteContent`.
