# Features — Marketing (módulo in-app)
**Rol:** fuente de verdad · **Última actualización:** 2026-06-23

## Qué es esta zona
Módulo de crecimiento del dashboard empresa (`/dashboard/marketing`): códigos de descuento, segmentos de compradores, email marketing (Resend) y analítica/tracking (GA4/Meta/GTM). NO confundir con el marketing de Instagram (contenido publicitario externo). NO hay sistema de planes/billing: el acceso es por permiso RBAC, no por plan pago. (Referidos fue **removido por completo** el 2026-06-24 — ver Deuda conocida.)

## Cómo se "oculta" / expone (importante — corrige una nota stale de memoria)
El módulo **NO está oculto con `visible: () => false`**. La nota de memoria "Módulo marketing construido pero oculto" está **desactualizada**. El gating real hoy es por **permiso RBAC**:
- Sidebar (`platea/components/dashboard/sidebar.tsx:77-82`): item "Marketing" gateado por `permiso: "ver_marketing"`.
- `ver_marketing` / `gestionar_marketing` **default `false`** (`backend/src/lib/permisos.ts:90-91`), pero **`true` en el rol `admin`** (`permisos.ts:253-254`). El dueño empresa y empleados con rol admin lo ven; el resto no.
- Las pages redirigen a `/sin-acceso` si `esEmpleado && !ver_marketing` (ej. `marketing/page.tsx:34`).

Estado nav (2026-06-24): la **pestaña Email** ya está **linkeada** en `marketing-secciones.ts` (era ruta huérfana, se expuso). La feature de **referidos fue removida del todo** (UI, endpoints, schema). La nav hoy lista: Promociones, Segmentos, Email, Analítica.

## Features
| Feature | Estado | Archivos clave | Notas / deuda |
|---|---|---|---|
| **Promociones / códigos de descuento** (CRUD + stats + export CSV) | ✅ | `backend/src/routes/marketing.ts:54-549` (GET/POST/PUT/DELETE `/promociones`, `/export`, `/stats`); `platea/app/(empresa)/dashboard/marketing/promociones/page.tsx`; modelo `MarketingCodigoDescuento` (`backend/prisma/schema.prisma:1340`) | Soft-delete (`activo=false`). Tipos: porcentaje / monto_fijo. Tabla de usos `MarketingCodigoDescuentoUso` (`schema:1362`). |
| **Aplicación del descuento en checkout público** (load-bearing) | ✅ | `backend/src/routes/tenant.ts:2847-3166` (valida código con `FOR UPDATE`, deflacta precios, persiste `descuento_monto`); `tenant.ts:1298-1330` (al confirmar pago: incrementa `usos_maximos`, inserta fila en `marketing_codigos_descuento_usos`) | Es el camino real de cobro: lo que valida MP usa el precio post-descuento. Frontend de checkout pasa `codigo_descuento`. |
| **Segmentos de compradores** (automáticos + manuales) | ✅ | `marketing.ts:856-1166` (`/segmentos`, `/segmentos/:id/compradores`); modelos `MarketingSegmento` (`schema:1317`), `MarketingSegmentoComprador` (`schema:1330`); `marketing/segmentos/page.tsx` | Auto-segmentos calculados en runtime (VIP, activos, nuevos, en riesgo, inactivos, carrito abandonado). Manuales = listas editables. Reutilizables como audiencia de campañas. |
| **Email marketing — campañas** (CRUD, enviar, stats, test-send) | ✅ | `marketing.ts:1168-1764,2199+` (`/email/configuracion`, `/campanas`, `/campanas/:id/enviar`, `/stats`, `/test-send`); modelos `MarketingCampana` (`schema:1271`), `MarketingEnvio` (`schema:1299`); `platea/components/dashboard/marketing/email-content.tsx`; rate-limit en `backend/src/index.ts:178,188` | **Linkeada en la nav desde 2026-06-24** (`marketing-secciones.ts` ahora lista Email entre Segmentos y Analítica; antes era ruta huérfana alcanzable solo por URL). Construida y funcional. Envío usa Resend con `from` de la empresa. |
| **Carrito abandonado** (automatización por cron) | ✅ | `backend/src/jobs/marketingCarritoAbandonadoJob.ts` (intervalo 15min, advisory lock **7701**, `prismaDirectUrl`); arranca en `index.ts:10` | Detecta `checkout_sessions` expiradas sin `entradas` confirmadas con email y dispara email. Único trigger automático real implementado de los 5 que listaba el plan (evento_proximo/reactivacion/bienvenida/post_evento NO existen). Toggle por env `MARKETING_CARRITO_ABANDONADO_ENABLED`. |
| **Analítica / tracking** (GA4, Meta Pixel, GTM) | ✅ | `marketing.ts:1781-1875` (`GET/PUT /analitica/tracking`); `marketing/analitica/page.tsx` + `analitica-content.tsx`; **inyección real** en `platea/components/tenant/tenant-surface-shell.tsx:51-95`; evento Purchase en `platea/components/tenant/pago-exito-content.tsx` | Funcional end-to-end: la empresa pega IDs → se inyectan scripts validados (regex) en el storefront público del tenant. Meta dispara `PageView`; Purchase al confirmar pago. |
| **Conexión Google (OAuth GA4/GTM)** | ✅ | `marketing.ts:2016-2166` (`/google/auth-url`, `/callback`, `/status`, `/ga4-properties`, `/gtm-containers`, selecciones); `backend/src/lib/google-marketing-oauth.ts` (445 líneas) | OAuth para autoseleccionar property GA4 / contenedor GTM en vez de pegar el ID a mano. |
| ~~**Referidos — programa + tracking**~~ | ❌ REMOVIDO (2026-06-24) | — | **Feature eliminada por completo.** El beneficio nunca se aplicaba (`beneficio_aplicado` jamás se seteaba, sin código de descuento/crédito), así que se removió todo en vez de completarlo: UI (tab + página + `referidos-content.tsx` + `referidos-section.tsx` del tenant + KPI card del overview), endpoints (`/referidos/programa` GET/PUT, `/stats`, `/mi-link`), tracking de conversión `ref_codigo` en el registro, modelos `ReferidosPrograma`/`Referido` + enums `EstadoReferidoEnum`/`BeneficioTipoEnum`. Migración `20260624010000_drop_referidos` (DROP TABLE IF EXISTS). ⚠️ El `?ref=` de **revendedores** (`revendedor_id`, otra feature) quedó intacto — usa `req.query.ref` validado contra `usuarios`, no `prisma.referido`. |
| ~~**Reviews de eventos** (Fase 7)~~ | ❌ REMOVIDO (2026-06-24) | — | Era vaporware: tabla `evento_reviews` con 0 rutas y 0 UI, nunca implementada. Removido el modelo `EventoReview` del schema + migración `20260624020000_drop_evento_reviews`. |

## Lo que NO hay (anti-alucinación)
- **NO hay sistema de planes/billing/suscripciones.** El acceso al módulo es por permiso RBAC (`ver_marketing`/`gestionar_marketing`), no por plan pago. No existe paywall.
- **NO hay referidos.** La feature fue removida por completo el 2026-06-24 (nunca aplicó beneficio). No quedan tablas, endpoints ni UI.
- **NO hay reviews de eventos.** La tabla vaporware `evento_reviews` fue removida el 2026-06-24 (nunca tuvo rutas ni UI).
- **NO existen los triggers automáticos** `evento_proximo`, `reactivacion`, `bienvenida`, `post_evento` que listaba el plan. El único cron real es **carrito abandonado**.
- ~~La pestaña Email NO está en la navegación~~ → **YA está linkeada** (2026-06-24).
- **NO está oculto con `visible: () => false`** (esa nota de memoria quedó vieja); el gating es por permiso de rol `admin`.
- El `MARKETING-MODULE-PLAN.md` marca **todas** las fases "✅ Completada" — es **optimista/inexacto**: Fase 6 (referidos) está a medias y Fase 7 (reviews) no existe. El plan también describe DB en MySQL/`actualizar db.sql`, esquema ya migrado a Postgres/Prisma.

## Deuda conocida
- ✅ ~~**Referidos sin motor de beneficio**~~ → RESUELTO (2026-06-24): feature **removida del todo** (no se iba a completar).
- ✅ ~~**Pestaña Email no linkeada**~~ → RESUELTO (2026-06-24): linkeada en `marketing-secciones.ts`.
- ✅ ~~**Timezone en reporting**~~ → RESUELTO (2026-06-24): auditoría completa; el `tenant.ts:1323` que se citaba ya no existía y el reporting de marketing ya tenía TZ. (Los 2 bugs reales de TZ encontrados estaban en `escanear.ts` y un test, no en marketing.) Ver `MEJORAS.md`.
- **Plan doc desincronizado** del estado real (ver arriba).

## Ver también
- `../FEATURES.md`
- `super-admin.md` — la consola de plataforma; `landing-announcement` (anuncios de la landing) es super-admin, NO este módulo.
- `../MARKETING-MODULE-PLAN.md` — plan de fases (tratar como aspiracional, no como estado real).
