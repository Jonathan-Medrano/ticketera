# Proposal: Split Configuración and Sitio de Venta

## Intent

Separar los dominios de `Configuración` y `Sitio de venta` para que cada pantalla lea y escriba solo sus propios campos, evitando contratos mezclados y sobrescrituras accidentales.

## Scope

### In Scope
- Separar lectura y escritura en endpoints dedicados para `Configuración` y `Sitio de venta`.
- Mantener `password` dentro de `Configuración`.
- Hacer PATCH parcial real con whitelist por dominio.

### Out of Scope
- Rediseño visual de ambas pantallas.
- Cambios de schema para nuevos campos públicos adicionales.
- Revisión de otros módulos no relacionados.

## Capabilities

### New Capabilities
- `configuracion-interna`: lectura y actualización de datos internos de cuenta/empresa.
- `sitio-venta-settings`: lectura y actualización de branding, slug y contenido público.

### Modified Capabilities
- `password-reset`: None

## Approach

Mantener `GET/PATCH /configuracion` para datos internos y crear `GET/PATCH /sitio-venta` para branding/editorial. El backend actualizará solo las claves presentes en cada payload y cada frontend consumirá su contrato dedicado.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/configuracion.ts` | Modified | Reducirlo a configuración interna |
| `backend/src/routes/index.ts` | Modified | Registrar ruta nueva de sitio de venta |
| `platea/components/dashboard/configuracion-content.tsx` | Modified | Consumir contrato interno dedicado |
| `platea/app/(empresa)/dashboard/sitio-venta/page.tsx` / `platea/components/dashboard/sitio-venta/editor-container.tsx` | Modified | Consumir contrato de sitio dedicado |
| `platea/app/api/configuracion/route.ts` | Modified | Mantener sólo configuración interna |
| `platea/app/api/configuracion/password/route.ts` | Modified | Mantener seguridad interna |
| `platea/app/api/sitio-venta/route.ts` | New | Proxy dedicado para branding/editorial |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Payloads viejos siguen mezclando campos | Med | Whitelist estricta en backend |
| Draft local de Sitio de venta queda desalineado | Med | Ajustar shape frontend y limpiar persistencia local |
| Pantallas dependen del payload compartido actual | Med | Separar GET y PATCH juntos, no por etapas |

## Rollback Plan

Revertir al contrato compartido anterior y restaurar proxies/rutas existentes si la separación rompe la edición de alguna pantalla.

## Dependencies

- Definición cerrada de ownership de campos
- Validación manual de ambas pantallas en frontend y backend

## Success Criteria

- [ ] `Configuración` actualiza solo `nombre`, `email`, `admin_*` y `comision_revendedor_default`.
- [ ] `Sitio de venta` actualiza solo `slug` y campos de branding/editorial.
- [ ] Ningún módulo pisa datos del otro al guardar.
