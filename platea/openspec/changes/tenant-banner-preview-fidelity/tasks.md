# Tasks: Tenant Banner Preview Fidelity

## Phase 1: Shared Hero Rules

- [x] 1.1 Crear `lib/tenant-hero-preview.ts` o `components/tenant/tenant-hero-presentational.tsx` con tokens/reglas compartidas para `banner_variant`, alturas, overlays, badges y prioridad de imagen del hero.
- [x] 1.2 Ajustar `components/tenant/tenant-home.tsx` para consumir solo esas reglas presentacionales compartidas si la extracción hace falta, sin mezclar dependencias runtime del slider, navbar o sesión.
- [x] 1.3 Dejar explícito en el helper compartido que el preview usa `banners[]` como fuente canónica y cae a fallback visual representativo; `imagen_hero` queda fuera del contrato soportado.

## Phase 2: Preview Alignment

- [x] 2.1 Refactorizar `HomeSettingsPreview` en `components/dashboard/sitio-venta/section-primitives.tsx` para derivar un hero view-model alineado con `tenant-home.tsx` usando `nombre`, `descripcion`, `mostrar_descripcion_home`, `banner_variant` y `banners`.
- [x] 2.2 Alinear en `components/dashboard/sitio-venta/section-primitives.tsx` la estructura visual del hero preview para `blurred` y `full`: alturas, overlays, jerarquía de texto, chips y spacing equivalentes al hero público.
- [x] 2.3 Mantener en `components/dashboard/sitio-venta/section-primitives.tsx` el card editorial inferior con `titulo_eventos_home`, `subtitulo_eventos_home`, CTA y datos mockeados del evento, fuera del hero principal.
- [x] 2.4 Usar placeholders representativos solo cuando falten datos públicos reales, manteniendo la composición del hero público en lugar de inventar copy o estados ajenos.

## Phase 3: Fallback And Failure States

- [x] 3.1 Ajustar `components/dashboard/remote-preview-image.tsx` solo si hace falta para que imagen ausente o fallida deje visible el mismo shell de fallback definido para el hero preview.
- [x] 3.2 Verificar en `components/dashboard/sitio-venta/section-primitives.tsx` que el hero nunca colapse a vacío cuando no haya banner usable o falle una URL remota, conservando la semántica visual de `blurred` y `full`.

## Phase 4: Validation And Regression

- [x] 4.1 Ejecutar validación manual comparando dashboard preview vs `components/tenant/tenant-home.tsx` para `banner_variant="blurred"`, confirmando tratamiento text-forward, overlays y badges equivalentes.
- [x] 4.2 Ejecutar validación manual comparando dashboard preview vs `components/tenant/tenant-home.tsx` para `banner_variant="full"`, confirmando tratamiento image-forward, chips premium y jerarquía visual equivalente.
- [x] 4.3 Validar regresión manual para banner faltante y URL rota en preview, comprobando que siga apareciendo un hero representativo y que el card editorial inferior permanezca intacto.
