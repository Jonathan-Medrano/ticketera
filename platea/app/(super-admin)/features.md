# Features — Super-Admin / Consola de plataforma (rollup)
**Rol:** rollup · **Última actualización:** 2026-06-23

## Qué es esta superficie
La consola del dueño de TICKETERA y su staff (`(super-admin)/super-admin/*`): gobierna empresas (tenants), comisiones de marketplace, métricas globales, mensajería, anuncio de landing, auditoría y observabilidad. Rollup FINO — todo el detalle vive en el módulo.

## Qué ofrece (resumen + link al módulo fuente de verdad)
| Sección (sidebar) | Módulo (detalle) | Estado |
|---|---|---|
| Dashboard (métricas owner, breakdown por flow) | [super-admin](../../../features/super-admin.md) | ✅ |
| Analítica (evolución de ingresos, comparativa) | [super-admin](../../../features/super-admin.md) | ✅ |
| Empresas (readiness, fees, gestión por empresa) | [super-admin](../../../features/super-admin.md) | ✅ |
| Comisiones (overrides de comisión del equipo por empresa) | [super-admin](../../../features/super-admin.md) · [revendedores](../../../features/revendedores.md) | ✅ |
| Mensajes (avisos a empresas) | [super-admin](../../../features/super-admin.md) | ✅ |
| Anuncio landing (barra superior pública editable) | [super-admin](../../../features/super-admin.md) | ✅ |
| Configuración (defaults globales, payout owner, conexión MP platform) | [super-admin](../../../features/super-admin.md) · [pagos-checkout](../../../features/pagos-checkout.md) | ✅ |
| Usuarios (jerarquía, capacidades, grants platform) | [super-admin](../../../features/super-admin.md) · [auth-onboarding](../../../features/auth-onboarding.md) | ✅ |
| Auditoría / Logs de errores / Rendimiento | [super-admin](../../../features/super-admin.md) | ✅ |

## Específico de esta superficie (lo que NO está en un módulo)
- **Layout + sidebar**: `(super-admin)/super-admin/layout.tsx`; nav en `platea/components/super-admin/sidebar.tsx:23-35`, agrupado en "Resumen" / "Operación" / "Sistema". Cada item gateado por `capability` `platform.*`; el sidebar filtra secciones según las capabilities del usuario (`sidebar.tsx:71`).
- **Modelo de acceso**: el `super_admin` singleton tiene todas las capabilities implícitas; el staff se rige por el catálogo de 11 capabilities (ver módulo super-admin, `backend/src/lib/platform-governance.ts:131-143`).
- Las pantallas son shells finos sobre las `*-section.tsx` de `platea/components/super-admin/` (`dashboard-section`, `empresas-section`, `usuarios-section`, etc.) — la lógica/datos de cada una está documentada en el módulo.

## Ver también
- `../../../FEATURES.md` (índice maestro).
- **Fuente de verdad de esta consola**: `../../../features/super-admin.md`.
