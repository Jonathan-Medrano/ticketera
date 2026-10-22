# Design: Align Sitio de Venta Banner Configuration

## Technical Approach

Reexponer en la sección editorial vigente de identidad/branding los controles ya existentes para `banner_variant` y `banners`, reutilizando el contrato actual de `SitioVentaForm`, `serializeSitioVentaPayload` y `RuntimePreview`. El cambio no crea un sistema nuevo: vuelve a conectar la UI split con la fuente canónica que hoy ya usan preview/runtime (`banners` + `banner_variant`) y endurece el PATCH backend para rechazar variantes o shapes inválidos.

## Architecture Decisions

### Decision: `banners` es la fuente canónica de hero compartida

| Option | Tradeoff | Decision |
|---|---|---|
| Seguir con `imagen_hero` paralela | Mantiene ambigüedad entre editor, preview y runtime | Rechazado |
| Crear un shape nuevo de banner | Agrega migración y complejidad innecesaria | Rechazado |
| Usar `banners` como contrato único de hero | Aprovecha soporte existente y elimina drift | Elegido |

Rationale: `lib/tenant-hero-preview.ts` y `components/tenant/tenant-home.tsx` ya resuelven el hero desde `banners`; la UI split debe editar ese mismo origen.

### Decision: los campos legacy de hero/footer salen del contrato

| Field | Status | Decision |
|---|---|---|
| `imagen_hero` | Campo legacy paralelo al hero | Se elimina del modelo editor, payload dashboard, API interna y respuesta pública tenant. La columna puede quedar en DB, pero deja de formar parte del contrato. |
| `imagen_footer` | Asset legacy de cierre/footer | Se elimina del editor, payload dashboard, API interna y respuesta pública tenant. La columna puede quedar en DB, pero deja de formar parte del contrato. |
| `footer_texto` | Texto legacy de cierre/footer | Se elimina del editor, payload dashboard, API interna y respuesta pública tenant. La columna puede quedar en DB, pero deja de formar parte del contrato. |

Rationale: el spec exige ownership explícito. No hace falta migrar datos ahora, pero sí cortar la ambigüedad contractual y funcional: hero = `banners`; los campos legacy de cierre/footer quedan fuera del contrato.

## Data Flow

`GET /api/sitio-venta`  
→ `createInitialSitioVentaForm()` normaliza `banner_variant` y `banners`  
→ la sección vigente de identidad/branding edita `form.banner_variant` y `form.banners` directamente  
→ `RuntimePreview` arma hero con `getTenantHeroPreviewModel({ banners, banner_variant })`  
→ guardar usa `serializeSitioVentaPayload(form)`  
→ `PATCH /api/sitio-venta` proxy  
→ `backend/src/routes/sitio-venta.ts` valida enum/array estrictamente y persiste  
→ runtime público lee `tenant.banners` + `tenant.banner_variant` sin fallback silencioso ni cierre/footer configurable.

Regla de compatibilidad: `sanitizeDraft()` sigue filtrando drafts inválidos en frontend, pero eso NO reemplaza validación de API.

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `openspec/changes/align-sitio-venta-banner-configuration/design.md` | Create | Diseño técnico del cambio. |
| `components/dashboard/sitio-venta/sections/identidad-section.tsx` | Modify | Reexponer selector de variante y lista editable de `banners` con copy canónico dentro de Identidad y Colores. |
| `components/dashboard/sitio-venta/model.ts` | Modify | Eliminar `imagen_hero`, `imagen_footer` y `footer_texto` del form/draft/payload soportado. |
| `components/dashboard/sitio-venta/preview/runtime-preview.tsx` | Verify/Minor Modify | Confirmar que siga leyendo solo `banners` + `banner_variant`; cambios mínimos si falta copy/guardas. |
| `lib/tenant-hero-preview.ts` | Verify/Minor Modify | Mantener helper canónico del hero sin volver a `imagen_hero`. |
| `backend/src/routes/sitio-venta.ts` | Modify | Rechazar `banner_variant` inválido y `banners` con shape no compatible, sin coerción silenciosa. |
| `components/dashboard/sitio-venta/model.test.ts` | Modify | Cubrir draft/form serialization y ownership esperado. |
| `lib/tenant-hero-preview.test.ts` | Modify | Cubrir que la fuente de hero siga siendo `banners`. |

## Interfaces / Contracts

```ts
type SitioVentaBannerPayload = {
  banner_variant?: "blurred" | "full"
  banners?: string[]
}
```

Contrato backend: si `banner_variant` no es `blurred | full`, responder `400`; si `banners` no es array de strings, responder `400`.

## Testing Strategy

| Layer | What to Test | Approach |
|-------|-------------|----------|
| Unit | `sanitizeDraft`, `createInitialSitioVentaForm`, serialización de `banners`/`banner_variant` | Extender `components/dashboard/sitio-venta/model.test.ts`. |
| Unit | Resolución canónica del hero | Extender `lib/tenant-hero-preview.test.ts`. |
| Integration | PATCH inválido no hace fallback a `blurred` | Agregar cobertura del route backend si ya existe patrón; si no, request manual focalizado. |
| E2E/manual | Editar variante + banners, previsualizar, guardar y recargar | Smoke manual en dashboard + página tenant pública. |

## Migration / Rollout

No migration required. El schema y los datos actuales ya soportan `banner_variant` y `banners`. El cuidado real está en compatibilidad de contrato: al endurecer el backend, clientes que antes dependían del fallback a `blurred` pasarán a recibir `400`, por lo que la UI split debe salir alineada en el mismo rollout. Las columnas legacy `imagen_hero`, `imagen_footer` y `footer_texto` pueden permanecer en DB, pero dejan de exponerse o aceptarse como parte del contrato.

## Open Questions

- [ ] No bloqueantes: definir si en un cambio futuro conviene borrar físicamente la columna `imagen_hero` de la base de datos.
