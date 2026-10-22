# Proposal: Redesign Sitio de Venta Editor

## Intent

Reenfocar `redesign-sitio-venta-editor` como una simplificación RADICAL del editor. El problema actual no es de datos ni de guardado: es una pantalla pesada, con demasiadas superficies, ejemplos, ayudas y previews compitiendo al mismo tiempo.

## Scope

### In Scope
- Mantener los dominios actuales: `Identidad y Colores`, `Home/Eventos`, `Consumibles`, `Soporte`.
- Rediseñar la shell para que haya una sola tarea principal visible por vez.
- Reorganizar formularios, ejemplos y ayudas para bajar fricción y mejorar comprensión.
- Volver el preview una referencia contextual secundaria, no una pantalla paralela.
- Compactar dominios de menor alcance (`Consumibles`, `Soporte`) y simplificar `Home/Eventos`.

### Out of Scope
- Cambiar payloads, endpoints, draft, dirty state o contrato de guardado.
- Rediseñar el tenant público completo.
- Agregar negocio nuevo, `Mis tickets` o nuevos dominios.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `sitio-venta-editor-shell`: la shell pasa a una narrativa de tarea principal única, con jerarquía visual más clara y menos contenedores fuertes.
- `sitio-venta-runtime-aligned-preview`: el preview pasa a ser contextual, liviano y subordinado a la edición activa.

## Approach

Aplicar un enfoque de **rediseño por tarea principal**: subnav liviana, un canvas editorial dominante, grupos de campos por prioridad, opciones avanzadas colapsables y referencias visuales pequeñas pero concretas. No alcanza con flattening cosmético; hay que simplificar la secuencia de lectura y decisión.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `components/dashboard/sitio-venta/editor-container.tsx` | Modified | Reducir peso de toolbar, alerts y composición general. |
| `components/dashboard/sitio-venta/editor-shell.tsx` | Modified | Reordenar shell y subnav alrededor de un canvas principal. |
| `components/dashboard/sitio-venta/section-primitives.tsx` | Modified | Eliminar primitives ruidosas y ejemplos pesados; unificar patrones. |
| `components/dashboard/sitio-venta/sections/*` | Modified | Reordenar formularios según prioridad real por dominio. |
| `components/dashboard/sitio-venta/preview/runtime-preview.tsx` | Modified | Convertir preview en apoyo contextual no invasivo. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Perder señales de ownership al simplificar | Med | Mantener labels y límites de dominio explícitos en shell/canvas. |
| Hacer solo maquillaje visual | Med | Forzar specs orientadas a flujo, jerarquía y carga cognitiva. |

## Rollback Plan

Revertir la iteración visual de shell/primitives/preview y volver a la composición anterior sin tocar contratos ni negocio.

## Dependencies

- Mantener alineación con `runtime-preview.tsx` y specs actuales sin abrir alcance funcional nuevo.

## Success Criteria

- [ ] El editor comunica una sola tarea principal por dominio, sin doble pantalla percibida.
- [ ] `Home/Eventos` reduce densidad de controles y ejemplos sin perder capacidad actual.
- [ ] `Consumibles` y `Soporte` quedan más compactos y acordes a su alcance real.
- [ ] El contrato actual de guardado y dominio se mantiene intacto.
