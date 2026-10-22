# Proposal: Super Admin Platform Console

## Intent

Hoy Platea tiene dashboards y configuración por empresa, pero no existe una consola global para el dueño de la plataforma. Eso impide administrar la cuenta Mercado Pago central del owner, visualizar ganancias agregadas, revisar empresas desde un panel principal y definir la comisión que Platea retiene por cada empresa. Este cambio introduce un super-admin de plataforma con un dashboard propio, métricas globales, listado de empresas y configuración de comisiones por empresa.

## Scope

### In Scope
- Identidad/superficie de acceso para un super-admin global de plataforma, autenticado desde el mismo login general pero identificado por datos persistidos internamente.
- Configuración de la cuenta Mercado Pago del owner desde la consola global.
- Dashboard principal del super-admin con métricas de ganancias, gráficos y resumen global.
- Listado de empresas con acceso a detalle económico por empresa.
- Modal por empresa para consultar ganancias asociadas a esa empresa.
- Configuración de comisión marketplace por empresa desde la consola del super-admin.
- Contrato backend/frontend diferenciado entre dashboard empresa y consola global owner.

### Out of Scope
- Registro público o auto-provisioning de cuentas super-admin.
- Multi-owner, roles complejos de backoffice o RBAC completo de staff interno.
- Conciliación contable avanzada, payout bancario o reportes fiscales.
- Rediseño total del dashboard empresa existente.
- Automatización de onboarding comercial más allá del control de comisiones y visibilidad operativa.

## Capabilities

### New Capabilities
- `super-admin-auth-surface`: acceso diferenciado para el owner de plataforma usando el login general y una identidad marcada internamente.
- `super-admin-dashboard`: tablero global con ganancias, gráficos y métricas agregadas.
- `super-admin-company-directory`: lista de empresas con modal de ganancias por empresa.
- `super-admin-company-fee-management`: configuración de comisión marketplace por empresa.
- `super-admin-owner-payment-account`: configuración de la cuenta Mercado Pago del owner en la consola global.

### Modified Capabilities
- `owner-controlled-marketplace-fee`: deja de vivir solamente en config interna/env y pasa a tener gestión desde consola global.
- `payment-connection-readiness`: debe seguir resolviendo la comisión owner-controlled por empresa, pero ahora desde configuración persistida de plataforma.

## Approach

Agregar una capa explícita de backoffice/platform admin separada del tenant empresa. El super-admin NO se registrará públicamente: sus cuentas serán definidas internamente en base de datos y luego iniciarán sesión desde el mismo flujo general que usa hoy el sistema. A partir de esa identidad marcada internamente, el backend habilitará endpoints exclusivos y el frontend mostrará una consola global fuera del dashboard empresa actual. La comisión marketplace por empresa se persistirá en un storage de plataforma y será usada por el flujo existente de readiness/checkout. El dashboard global mostrará ganancias agregadas de Platea, breakdown temporal y un directorio de empresas con detalle económico por modal.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `backend/src/routes/auth.ts` o nueva superficie auth | Modified/New | Soporte de acceso para super-admin global |
| `backend/src/routes/*` | New | Endpoints exclusivos de consola global: dashboard, empresas, comisiones, cuenta MP owner |
| `backend/src/lib/marketplace-fee.ts` | Modified | Leer comisión por empresa desde storage persistido de plataforma |
| `backend/src/lib/sales-readiness.ts` | Modified | Mantener sellability basada en fee resoluble por empresa |
| `actualizar db.sql` | Modified | Nuevas tablas/columnas para owner admin y fee por empresa |
| `platea/app/*` | New | Sección de super-admin separada del dashboard empresa |
| `platea/components/*` | New | Dashboard global, tabla de empresas, modal de ganancias y form de comisión |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Mezclar consola owner con dashboard empresa | High | Separar rutas, auth y layout desde el diseño |
| Romper fee actual al migrar de env a storage persistido | Med | Migración incremental con fallback controlado |
| Exponer datos globales sensibles a tenants | High | Middleware y contratos completamente separados |
| Definir métricas inconsistentes de “ganancia” | Med | Especificar con precisión qué suma el dashboard owner |

## Rollback Plan

Mantener el fee owner-controlled existente como fallback interno, desactivar temporalmente la consola global y conservar el dashboard empresa sin cambios si el backoffice owner necesita corrección.

## Dependencies

- Modelo persistido para comisión marketplace por empresa.
- Definición de autenticación/autorización del super-admin marcada en base de datos, sin alta pública.
- Datos agregables desde ventas/entradas/fees para construir métricas globales del owner.

## Suggested Phases

1. Definir identidad/rutas del super-admin y storage de comisión por empresa.
2. Migrar la fuente owner-controlled de env/config interna a persistencia gestionable.
3. Construir dashboard global con métricas, gráficos y listado de empresas.
4. Agregar modal de ganancias por empresa y pantalla/configuración de cuenta MP owner.

## Success Criteria

- [ ] El owner puede entrar a una consola global separada del dashboard empresa usando el login general y una cuenta marcada internamente como super-admin.
- [ ] El owner puede configurar su cuenta Mercado Pago desde esa consola.
- [ ] El owner puede ver ganancias globales y gráficos agregados desde un dashboard principal.
- [ ] El owner puede listar empresas y abrir un modal de ganancias por empresa.
- [ ] El owner puede definir la comisión marketplace que Platea retiene para cada empresa.
