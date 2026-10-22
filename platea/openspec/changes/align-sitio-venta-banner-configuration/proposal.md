# Proposal: Align Sitio de Venta Banner Configuration

## Intent

Cerrar la brecha real del editor split de `Sitio de venta`: el soporte de `banner_variant` y `banners` YA existe en backend, runtime y preview, pero la UI nueva no reexpone esa configuración y deja el contrato visible incompleto. Además, hay que endurecer validaciones y cerrar el contrato eliminando `imagen_hero` y cualquier cierre/footer legacy fuera de la fuente canónica.

## Scope

### In Scope
- Restaurar en la sección editorial vigente de identidad/branding la edición visible de `banner_variant` (`blurred | full`) y `banners` (`string[]`).
- Alinear editor, preview y runtime contra la misma fuente canónica de datos, sin reintroducir shapes paralelos.
- Endurecer validación API para rechazar variantes inválidas y payloads con shape incorrecto en lugar de hacer fallback silencioso.
- Dejar explícito que `imagen_hero`, `imagen_footer` y `footer_texto` salen del contrato soportado.

### Out of Scope
- Rediseñar completo el tenant público.
- Crear un sistema de banners nuevo.
- Cambiar otros módulos de negocio no relacionados con `Sitio de venta`.

## Capabilities

### New Capabilities
- `sitio-venta-banner-configuration`: edición canónica, preview y contrato público consistentes para `banner_variant` y `banners`.

### Modified Capabilities
- None.

## Approach

Tomar como hecho que NO falta soporte de backend/runtime/preview y concentrar el cambio en reexponer la configuración en la UI correcta. La propuesta debe usar una única fuente canónica para editor, preview y runtime, y eliminar tolerancia silenciosa del contrato: si el enum o el shape son inválidos, la API debe responder como inválido. En paralelo, el spec debe dejar fijado que `imagen_hero`, `imagen_footer` y `footer_texto` quedan eliminados del contrato soportado.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `openspec/changes/align-sitio-venta-banner-configuration/proposal.md` | New | Define alcance y contrato del cambio. |
| `components/dashboard/sitio-venta/sections/identidad-section.tsx` | Modified | UI vigente para variante y lista de banners dentro de Identidad y Colores. |
| `components/dashboard/sitio-venta/preview/runtime-preview.tsx` | Referenced | Debe seguir la fuente canónica, no un shape alterno. |
| `components/tenant/tenant-home.tsx` | Referenced | Runtime público ya soporta variantes y banners. |
| `backend/src/routes/sitio-venta.ts` | Modified | Validación estricta de enum y shape. |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| UI nueva siga escribiendo campos legacy en paralelo | Med | Definir ownership canónico antes del spec. |
| Endurecer validación rompa clientes tolerados hoy | Med | Documentar contrato esperado y ajustar editor junto con API. |

## Rollback Plan

Revertir la reexposición de UI y volver temporalmente a la validación tolerante actual si aparece incompatibilidad crítica, manteniendo intacto el soporte existente de runtime/preview.

## Dependencies

- Confirmar contrato final: hero/runtime editorial = `banners` + `banner_variant`; no hay cierre/footer configurable en `Sitio de venta`.

## Success Criteria

- [ ] La propuesta deja explícito que el gap NO está en backend/runtime/preview sino en la UI split actual.
- [ ] El futuro spec puede validar edición visible y persistencia consistente de `banner_variant` y `banners`.
- [ ] El contrato API deja de aceptar enum o shape inválidos mediante fallback silencioso.
- [ ] Queda registrada la eliminación de `imagen_hero`, `imagen_footer` y `footer_texto` del contrato soportado.
