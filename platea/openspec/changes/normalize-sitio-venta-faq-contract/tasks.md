# Tasks: Normalize Sitio de Venta FAQ Contract

## Phase 1: Canonical FAQ contract

- [x] 1.1 Ajustar `components/dashboard/sitio-venta/model.ts` para definir el shape FAQ con `id`, `source` y `order`, y normalizar `createInitialSitioVentaForm` sobre una única colección editable.
- [x] 1.2 Extender `components/dashboard/sitio-venta/model.ts` y `lib/tenant.ts` para parsear `faqs` tanto en shape nuevo como en array legacy, asignando ids canónicos a defaults e ids determinísticos a custom.
- [x] 1.3 Actualizar `components/dashboard/sitio-venta/model.ts` para serializar sólo la colección normalizada, preservando orden persistible y evitando fallback paralelo fuera de `faqs`.

## Phase 2: Shared defaults and resolver

- [x] 2.1 Refactorizar `lib/tenant-support.ts` para exponer el catálogo default FAQ con ids canónicos y dejar una sola fuente de defaults reutilizable por editor, preview y runtime.
- [x] 2.2 Crear en `lib/tenant-support.ts` el resolver compartido de FAQs resultantes y el helper de restore no destructivo que agrega sólo defaults faltantes y reindexa `order`.
- [x] 2.3 Revisar consumidores en `components/dashboard/sitio-venta/model.ts` y `lib/tenant.ts` para que toda normalización/render derive del resolver compartido, no de merges ad hoc.

## Phase 3: Editor and surfaces alignment

- [x] 3.1 Ajustar `components/dashboard/sitio-venta/section-primitives.tsx` para mostrar defaults y custom dentro de la misma lista editable, con remove por item sin borrados inferidos.
- [x] 3.2 Incorporar en `components/dashboard/sitio-venta/section-primitives.tsx` restore defaults no destructivo y reorder por `id`, persistiendo `order` en el estado del formulario.
- [x] 3.3 Alinear `components/dashboard/sitio-venta/preview/runtime-preview.tsx` y `components/tenant/soporte-content.tsx` para consumir exactamente el mismo resolver FAQ y respetar el orden persistido sin fallback excluyente.

## Phase 4: Tests and verification

- [x] 4.1 Extender `components/dashboard/sitio-venta/model.test.ts` con casos de parse nuevo/legacy, ids default/custom, serialización y preservación de `order` al recargar.
- [x] 4.2 Extender `lib/tenant-support.test.ts` con casos de catálogo/resolver, coexistencia defaults/custom, restore sin duplicados y reorder independiente de índice o texto.
- [x] 4.3 Extender `components/dashboard/sitio-venta/preview/runtime-preview.test.ts` y la cobertura disponible de `components/tenant/soporte-content.tsx` para demostrar que preview y runtime resuelven la misma colección FAQ.
- [ ] 4.4 Ejecutar smoke manual del flujo real: cargar tenant legacy, quitar un default, agregar custom, reordenar, restaurar defaults, guardar, recargar y contrastar preview vs runtime público.
